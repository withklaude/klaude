import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { DockerManager, demuxExecStream } from './docker.js';
import { ConfigManager } from './config-manager.js';
import { TaskLoader } from './task-loader.js';
import { RateLimitDetector } from './rate-limiter.js';
import { NetworkMonitor } from './network-monitor.js';
import { StateManager } from './state-manager.js';
import type { TaskState, RunState, RunOptions } from '../types/index.js';

export class ContainerRunner extends EventEmitter {
  private docker: DockerManager;
  private config: ConfigManager;
  private stateManager: StateManager;
  private runState: RunState;
  private networkMonitor: NetworkMonitor;
  private containerId?: string;

  constructor(private options: RunOptions) {
    super();
    this.docker = new DockerManager();
    this.config = new ConfigManager();
    this.stateManager = new StateManager(this.config.getProjectDir()!);
    this.networkMonitor = new NetworkMonitor();

    this.runState = {
      id: new Date().toISOString().replace(/[:.]/g, '-'),
      started_at: new Date().toISOString(),
      tasks: [],
      options,
    };
  }

  /** Full run: start container → configure → run tasks → stop */
  async run(taskNames?: string[]): Promise<RunState> {
    await this.preflight();

    // Load and validate tasks
    const loader = new TaskLoader(this.config.getTasksDir()!);
    let tasks = loader.loadAll();

    if (taskNames && taskNames.length > 0) {
      tasks = tasks.filter(t => taskNames.includes(t.name));
      if (tasks.length === 0) {
        throw new Error(`No matching tasks found for: ${taskNames.join(', ')}`);
      }
    }

    for (const task of tasks) {
      const errors = loader.validate(task);
      if (errors.length > 0) {
        throw new Error(`Task "${task.name}" has errors:\n  ${errors.join('\n  ')}`);
      }
    }

    // Validate and sort by dependencies
    const depErrors = loader.validateDependencies(tasks);
    if (depErrors.length > 0) {
      throw new Error(`Dependency errors:\n  ${depErrors.join('\n  ')}`);
    }
    tasks = loader.sortByDependencies(tasks);

    this.runState.tasks = tasks.map(t => ({
      task: t,
      status: 'pending' as const,
      rate_limits_hit: 0,
      network_errors: 0,
    }));

    if (this.options.dryRun) {
      this.emit('dry-run', this.runState);
      return this.runState;
    }

    fs.mkdirSync(this.getRunDir(), { recursive: true });

    this.networkMonitor.start();
    this.setupNetworkListeners();

    await this.ensureImage();

    try {
      // Start one container for the whole run
      await this.startContainer();

      // Configure git and Claude inside the container
      await this.configureContainer();
      await this.healthcheck();

      // Determine which tasks to run (handle resume)
      const tasksToRun: TaskState[] = [];

      if (this.options.resume) {
        const recovered = this.stateManager.recoverInterrupted();
        if (recovered.length > 0) {
          this.emit('log', `Recovered ${recovered.length} interrupted task(s): ${recovered.join(', ')}`);
        }
      }

      for (const taskState of this.runState.tasks) {
        if (this.options.resume && !this.stateManager.shouldRun(taskState.task.name)) {
          const s = this.stateManager.get(taskState.task.name);
          taskState.status = s.status === 'completed' ? 'completed' : 'failed';
          this.emit('task-skip', { task: taskState.task.name, reason: s.status });
          continue;
        }
        tasksToRun.push(taskState);
      }

      if (tasksToRun.length > 0) {
        const skipped = this.runState.tasks.length - tasksToRun.length;
        if (skipped > 0) {
          this.emit('log', `Resuming: skipping ${skipped} completed task(s), running ${tasksToRun.length}`);
        }
        await this.executeAllTasks(tasksToRun);
      }
    } finally {
      await this.stopContainer();
      this.networkMonitor.stop();
      this.runState.completed_at = new Date().toISOString();
      await this.writeReport();
    }

    return this.runState;
  }

  // ─── Container (one per run) ────────────────────────────────

  private async startContainer(): Promise<void> {
    const envVars: Record<string, string> = {
      ...this.config.get<Record<string, string>>('env'),
    };
    const apiKey = this.config.resolveApiKey();
    if (apiKey) envVars.ANTHROPIC_API_KEY = apiKey;

    this.containerId = await this.docker.createContainer({
      name: `run-${this.runState.id}`,
      repoPath: this.config.getProjectRoot()!,
      config: this.config.getMergedConfig(),
      envVars,
      extraMounts: this.config.get<string[]>('mounts') || [],
      claudeConfigDir: this.config.getClaudeConfigDir(),
    });

    this.emit('log', `Container started (${this.containerId.slice(0, 12)})`);
  }

  private async stopContainer(): Promise<void> {
    if (!this.containerId) return;
    try {
      await this.docker.stopContainer(this.containerId);
      await this.docker.removeContainer(this.containerId);
    } catch { /* ignore */ }
    this.containerId = undefined;
  }

  /** Public shutdown — stops container and network monitor */
  async shutdown(): Promise<void> {
    await this.stopContainer();
    this.networkMonitor.stop();
  }

  /** Configure the container environment (git, Claude config) */
  private async configureContainer(): Promise<void> {
    // Git user/email so Claude can commit
    const gitUser = this.config.get<string>('git.user') || 'klaude';
    const gitEmail = this.config.get<string>('git.email') || 'klaude@automated';

    await this.docker.exec(this.containerId!, [
      'git', 'config', '--global', 'user.name', gitUser,
    ]);
    await this.docker.exec(this.containerId!, [
      'git', 'config', '--global', 'user.email', gitEmail,
    ]);

    // Git token for push
    const gitToken = this.config.get<string>('git.token');
    if (gitToken) {
      await this.docker.exec(this.containerId!, [
        'bash', '-c', `echo "https://x-access-token:${gitToken}@github.com" > ~/.git-credentials && git config --global credential.helper store`,
      ]);
    }

    // Fix permissions on mounted ~/.claude so Claude Code can read/write (refresh tokens)
    const claudeDir = this.config.getClaudeConfigDir();
    if (claudeDir) {
      await this.docker.exec(this.containerId!, [
        'sudo', 'chown', '-R', 'klaude:klaude', '/home/klaude/.claude',
      ]);

      // Copy ~/.claude.json into container (can't bind-mount single files on Windows)
      const claudeJsonPath = path.join(os.homedir(), '.claude.json');
      if (fs.existsSync(claudeJsonPath)) {
        const content = fs.readFileSync(claudeJsonPath, 'utf-8');
        await this.docker.writeFile(this.containerId!, '/home/klaude/.claude.json', content);
        await this.docker.exec(this.containerId!, [
          'sudo', 'chown', 'klaude:klaude', '/home/klaude/.claude.json',
        ]);
        this.emit('log', `Copied .claude.json (${content.length} bytes)`);
      } else {
        this.emit('log', `Warning: ${claudeJsonPath} not found`);
      }
    }

    this.emit('log', `Container configured (git: ${gitUser} <${gitEmail}>)`);
  }

  private async healthcheck(): Promise<void> {
    this.emit('log', 'Running healthcheck...');
    const checks: Array<{ name: string; cmd: string[]; validate?: (output: string) => boolean }> = [
      {
        name: 'Container responsive',
        cmd: ['echo', 'ok'],
        validate: (out) => out.trim() === 'ok',
      },
      {
        name: 'Git available',
        cmd: ['git', '--version'],
        validate: (out) => out.includes('git version'),
      },
      {
        name: 'Claude Code CLI available',
        cmd: ['claude', '--version'],
      },
      {
        name: 'Workspace mounted',
        cmd: ['ls', '/workspace'],
      },
      {
        name: 'API key or Claude config present',
        cmd: ['bash', '-c', 'test -n "$ANTHROPIC_API_KEY" || test -f ~/.claude.json && echo ok'],
        validate: (out) => out.trim() === 'ok',
      },
      {
        name: 'Claude auth works',
        cmd: ['bash', '-c', 'claude --print --dangerously-skip-permissions "Say OK" 2>&1'],
        validate: (out) => !out.includes('Invalid API key') && !out.includes('Authentication'),
      },
    ];

    for (const check of checks) {
      try {
        const { stream } = await this.docker.exec(this.containerId!, check.cmd);
        const output = await this.streamToString(stream);
        if (check.validate && !check.validate(output)) {
          throw new Error(`Validation failed: ${output}`);
        }
        this.emit('log', `  ✓ ${check.name}`);
      } catch (err) {
        throw new Error(`Healthcheck failed: ${check.name} — ${(err as Error).message}`);
      }
    }

    this.emit('log', 'Healthcheck passed.');
  }

  // ─── Task Execution (single Claude session via agent.md) ────

  /** Serialize tasks to JSON for the agent */
  private buildTasksJson(taskStates: TaskState[]): string {
    const tasks = taskStates.map(ts => ({
      name: ts.task.name,
      prompt: ts.task.prompt,
      depends_on: ts.task.depends_on || [],
      priority: ts.task.priority || 0,
    }));

    return JSON.stringify({ tasks }, null, 2);
  }

  /** Read agent.md template and inject project config */
  private buildAgentMd(): string {
    const agentMdPath = path.join(
      path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')),
      '..', 'templates', 'agent.md',
    );
    let agentMd = fs.readFileSync(agentMdPath, 'utf-8');

    // Read project agent config (.klaude/agent.yaml)
    let agentConfig = '_No project-specific configuration._';
    const projectDir = this.config.getProjectDir();
    if (projectDir) {
      const agentYamlPath = path.join(projectDir, 'agent.yaml');
      if (fs.existsSync(agentYamlPath)) {
        agentConfig = fs.readFileSync(agentYamlPath, 'utf-8');
      }
    }

    agentMd = agentMd.replace('{{AGENT_CONFIG}}', agentConfig);

    // Inject environment variable names
    const env = this.config.get<Record<string, string>>('env');
    let envVars = '_No custom environment variables configured._';
    if (env && Object.keys(env).length > 0) {
      envVars = Object.keys(env).map(name => `- \`$${name}\``).join('\n');
    }
    agentMd = agentMd.replace('{{ENV_VARS}}', envVars);

    return agentMd;
  }

  /** Launch Claude once with agent.md to execute all tasks */
  private async executeAllTasks(taskStates: TaskState[]): Promise<void> {
    const detector = new RateLimitDetector();

    for (const ts of taskStates) {
      ts.status = 'running';
      ts.started_at = new Date().toISOString();
      ts.container_id = this.containerId;
      this.stateManager.markRunning(ts.task.name, this.runState.id);
    }
    this.emit('task-start', taskStates.map(t => t.task.name).join(', '));

    const totalTimeoutMinutes = taskStates.reduce((sum, ts) => {
      return sum + (ts.task.settings?.timeout || this.options.timeout || 0);
    }, 0);
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    // Capture git HEAD before
    let headBefore = '';
    try {
      const { stream: headStream } = await this.docker.exec(this.containerId!, [
        'git', '-C', '/workspace', 'rev-parse', 'HEAD',
      ]);
      headBefore = await this.streamToString(headStream);
    } catch { /* git not initialized */ }

    try {
      // Write tasks.json into the container
      const tasksJson = this.buildTasksJson(taskStates);
      await this.docker.writeFile(this.containerId!, '/tmp/tasks.json', tasksJson);

      // Write compiled agent.md (with project config injected)
      const agentMd = this.buildAgentMd();
      await this.docker.writeFile(this.containerId!, '/agent.md', agentMd);

      // Initialize empty status file
      await this.docker.writeFile(this.containerId!, '/tmp/klaude-tasks-status.json', '{"tasks":[]}');

      // Launch claude-wrapper — it starts Claude with agent.md
      const { stream } = await this.docker.exec(this.containerId!, [
        '/usr/local/bin/claude-wrapper',
        this.options.overnight ? '999' : '10',
      ]);

      // Stream output
      const demuxed = demuxExecStream(stream);
      const streamPromise = new Promise<void>((resolve, reject) => {
        let output = '';

        demuxed.on('data', ({ type: streamType, data }: { type: 'stdout' | 'stderr'; data: string }) => {
          output += data;
          for (const line of data.split('\n').filter((l: string) => l.trim())) {
            const parsed = detector.parseLogLine(line);
            const emitType = (parsed.type === 'rate_limit' || parsed.type === 'network_error')
              ? parsed.type : streamType;
            this.emit('task-output', { task: '__all__', type: emitType, raw: parsed.raw });

            if (parsed.type === 'rate_limit') {
              this.emit('rate-limit', { task: '__all__', count: detector.getStats().rateLimitsHit });
            } else if (parsed.type === 'network_error') {
              this.emit('network-error', { task: '__all__', count: detector.getStats().networkErrors });
            }
          }
        });

        demuxed.on('end', () => {
          const logPath = path.join(this.getRunDir(), 'session.log');
          fs.writeFileSync(logPath, output, 'utf-8');
          resolve();
        });

        demuxed.on('error', reject);
      });

      const timeoutPromise = totalTimeoutMinutes > 0
        ? new Promise<void>((_resolve, reject) => {
            timeoutHandle = setTimeout(async () => {
              try {
                await this.docker.exec(this.containerId!, ['pkill', '-f', 'claude']);
              } catch { /* ignore */ }
              this.emit('task-timeout', { task: '__all__', timeout: totalTimeoutMinutes });
              reject(new Error(`Session timed out after ${totalTimeoutMinutes} minutes`));
            }, totalTimeoutMinutes * 60 * 1000);
          })
        : null;

      await (timeoutPromise ? Promise.race([streamPromise, timeoutPromise]) : streamPromise);

      // Read task results written by Claude
      await this.resolveTaskStatuses(taskStates);

    } catch (err) {
      // On crash/timeout, still try to read partial results
      await this.resolveTaskStatuses(taskStates);
      for (const ts of taskStates) {
        if (ts.status === 'running' || ts.status === 'waiting') {
          ts.status = 'failed';
          ts.error = ts.error || (err as Error).message;
          this.emit('task-error', { task: ts.task.name, error: ts.error });
        }
      }
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);

      // Capture git diff for the session
      try {
        const { stream: diffStream } = await this.docker.exec(this.containerId!, [
          'git', '-C', '/workspace', 'diff', 'HEAD',
        ]);
        const diff = await this.streamToString(diffStream);

        let commitLog = '';
        if (headBefore.trim()) {
          const { stream: logStream } = await this.docker.exec(this.containerId!, [
            'git', '-C', '/workspace', 'log', '--oneline', `${headBefore.trim()}..HEAD`,
          ]);
          commitLog = await this.streamToString(logStream);
        }

        const diffPath = path.join(this.getRunDir(), 'session.diff');
        const diffContent = `# Git changes for session\n\n## Commits\n${commitLog}\n\n## Uncommitted diff\n${diff}`;
        fs.writeFileSync(diffPath, diffContent, 'utf-8');
      } catch { /* ignore git errors */ }

      // Finalize all task states
      for (const ts of taskStates) {
        ts.completed_at = ts.completed_at || new Date().toISOString();
        if (ts.status === 'completed') {
          this.stateManager.markCompleted(ts.task.name);
        } else {
          if (ts.status === 'running') ts.status = 'failed';
          this.stateManager.markFailed(ts.task.name, ts.error);
        }
      }

      const stats = detector.getStats();
      this.emit('task-done', {
        task: '__all__',
        status: taskStates.every(t => t.status === 'completed') ? 'completed' : 'failed',
        rateLimits: stats.rateLimitsHit,
        networkErrors: stats.networkErrors,
        waitTime: stats.totalWaitTimeMs,
      });
    }
  }

  /** Read /tmp/klaude-tasks-status.json written by Claude */
  private async resolveTaskStatuses(taskStates: TaskState[]): Promise<void> {
    const tasksStatusJson = await this.docker.readFile(this.containerId!, '/tmp/klaude-tasks-status.json');
    if (!tasksStatusJson) return;

    try {
      const parsed = JSON.parse(tasksStatusJson);
      if (!parsed.tasks || !Array.isArray(parsed.tasks)) return;

      for (const result of parsed.tasks) {
        const ts = taskStates.find(t => t.task.name === result.name);
        if (!ts) continue;
        if (result.status === 'completed') {
          ts.status = 'completed';
        } else {
          ts.status = 'failed';
          ts.error = result.summary || `Task ${result.status}`;
        }
        ts.completed_at = new Date().toISOString();
      }
    } catch { /* ignore JSON parse errors */ }
  }

  private async streamToString(stream: NodeJS.ReadableStream): Promise<string> {
    const demuxed = demuxExecStream(stream);
    return new Promise<string>((resolve, reject) => {
      const parts: string[] = [];
      demuxed.on('data', ({ data }: { type: string; data: string }) => parts.push(data));
      demuxed.on('end', () => resolve(parts.join('')));
      demuxed.on('error', reject);
    });
  }

  // ─── Preflight ──────────────────────────────────────────────

  private async preflight(): Promise<void> {
    if (!await this.docker.isAvailable()) {
      throw new Error('Docker is not available. Make sure Docker Desktop is running.');
    }
    if (!this.config.getProjectRoot()) {
      throw new Error('Not inside a klaude project. Run "klaude init" first.');
    }
    if (!this.config.getTasksDir()) {
      throw new Error('Tasks directory not found.');
    }
    const apiKey = this.config.resolveApiKey();
    const claudeDir = this.config.getClaudeConfigDir();
    if (!apiKey && !claudeDir) {
      throw new Error(
        'No Anthropic API key found and no Claude Code config directory.\n' +
        'Set via: klaude config set anthropic.api_key <key> --global\n' +
        'Or ensure Claude Code is configured on this machine.',
      );
    }
  }

  private async ensureImage(): Promise<void> {
    const imageName = this.config.get<string>('docker.image') || 'klaude-ubuntu';
    const registryImage = this.config.get<string>('docker.registry_image') || 'ghcr.io/withklaude/klaude';
    const ageHours = await this.docker.imageAgeHours(imageName);
    const maxAge = this.config.get<number>('docker.rebuild_after_hours') ?? 24;

    if (!this.options.rebuild && ageHours !== null && ageHours < maxAge) {
      this.emit('log', `Docker image "${imageName}" found (${Math.round(ageHours)}h old).`);
      return;
    }

    if (this.options.rebuild) {
      this.emit('log', `Rebuilding Docker image "${imageName}" (--rebuild)...`);
    }

    // Lock to prevent concurrent rebuilds across projects
    const lockFile = path.join(os.tmpdir(), `klaude-build-${imageName}.lock`);
    if (fs.existsSync(lockFile)) {
      this.emit('log', `Another process is building "${imageName}", waiting...`);
      while (fs.existsSync(lockFile)) {
        await new Promise(r => setTimeout(r, 3000));
      }
      this.emit('log', `Image "${imageName}" ready.`);
      return;
    }

    try {
      fs.writeFileSync(lockFile, String(process.pid), 'utf-8');

      // Try pulling from registry first
      this.emit('log', `Pulling "${registryImage}:latest"...`);
      this.docker.on('pull-log', (line: string) => this.emit('build-log', line));
      const pulled = await this.docker.pullImage(`${registryImage}:latest`);

      if (pulled) {
        // Tag the pulled image with the local name
        const image = this.docker.getImage(`${registryImage}:latest`);
        await image.tag({ repo: imageName, tag: 'latest' });
        this.emit('log', `Image pulled and tagged as "${imageName}".`);
      } else {
        // Fallback: build locally
        this.emit('log', `Pull failed, building "${imageName}" locally...`);
        this.docker.on('build-log', (line: string) => this.emit('build-log', line));
        await this.docker.buildImage(imageName);
        this.emit('log', `Docker image "${imageName}" built successfully.`);
      }
    } finally {
      try { fs.unlinkSync(lockFile); } catch { /* ignore */ }
    }
  }

  // ─── Network ────────────────────────────────────────────────

  private setupNetworkListeners(): void {
    this.networkMonitor.on('offline', () => {
      this.emit('log', '⚠ Network offline. Tasks will resume when connectivity returns.');
    });
    this.networkMonitor.on('online', ({ downtimeSeconds }: { downtimeSeconds: number }) => {
      this.emit('log', `✓ Network restored after ${downtimeSeconds}s downtime.`);
    });
    this.networkMonitor.on('waiting', ({ nextCheckIn }: { nextCheckIn: number }) => {
      this.emit('log', `Waiting for network... next check in ${nextCheckIn}s`);
    });
  }

  // ─── Reporting ──────────────────────────────────────────────

  private getRunDir(): string {
    return path.join(this.config.getProjectDir()!, 'runs', this.runState.id);
  }

  private async writeReport(): Promise<void> {
    const runDir = this.getRunDir();
    const completed = this.runState.tasks.filter(t => t.status === 'completed').length;
    const failed = this.runState.tasks.filter(t => t.status === 'failed').length;
    const total = this.runState.tasks.length;
    const totalRateLimits = this.runState.tasks.reduce((s, t) => s + t.rate_limits_hit, 0);
    const totalNetworkErrors = this.runState.tasks.reduce((s, t) => s + t.network_errors, 0);

    const startTime = new Date(this.runState.started_at);
    const endTime = this.runState.completed_at ? new Date(this.runState.completed_at) : new Date();
    const durationMin = Math.round((endTime.getTime() - startTime.getTime()) / 60_000);

    const report = `# Klaude Run Report

- **Run ID:** ${this.runState.id}
- **Started:** ${this.runState.started_at}
- **Completed:** ${this.runState.completed_at || 'in progress'}
- **Duration:** ${durationMin} minutes
- **Mode:** ${this.options.overnight ? 'overnight' : 'standard'}

## Results

- **Total tasks:** ${total}
- **Completed:** ${completed} ✓
- **Failed:** ${failed} ✗
- **Rate limits hit:** ${totalRateLimits}
- **Network errors:** ${totalNetworkErrors}

## Changes

${this.runState.tasks.map(t => {
      const diffPath = path.join(runDir, `${t.task.name}.diff`);
      if (!fs.existsSync(diffPath)) return null;
      const size = fs.statSync(diffPath).size;
      return `- ${t.task.name}.diff (${size} bytes)`;
    }).filter(Boolean).join('\n') || '_No diffs captured_'}

## Task Details

${this.runState.tasks.map(t => `### ${t.task.name}
- Status: ${t.status}
- Rate limits: ${t.rate_limits_hit}
- Network errors: ${t.network_errors}
${t.error ? `- Error: ${t.error}` : ''}
`).join('\n')}
`;

    fs.writeFileSync(path.join(runDir, 'report.md'), report, 'utf-8');
    fs.writeFileSync(
      path.join(runDir, 'state.json'),
      JSON.stringify(this.runState, null, 2),
      'utf-8',
    );
  }
}
