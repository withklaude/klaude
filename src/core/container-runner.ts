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

      if (this.options.resume) {
        // Reset tasks stuck in 'running' state (from interrupted runs)
        const recovered = this.stateManager.recoverInterrupted();
        if (recovered.length > 0) {
          this.emit('log', `Recovered ${recovered.length} interrupted task(s): ${recovered.join(', ')}`);
        }

        // Report what will be skipped vs re-run
        const willSkip = this.runState.tasks.filter(t => !this.stateManager.shouldRun(t.task.name));
        const willRun = this.runState.tasks.filter(t => this.stateManager.shouldRun(t.task.name));
        if (willSkip.length > 0) {
          this.emit('log', `Resuming: skipping ${willSkip.length} completed task(s), running ${willRun.length}`);
        }
      }

      // Run each task: skip completed/skipped, check deps, retry failed, run pending
      for (const taskState of this.runState.tasks) {
        if (!this.stateManager.shouldRun(taskState.task.name)) {
          const s = this.stateManager.get(taskState.task.name);
          taskState.status = s.status === 'completed' ? 'completed' : 'failed';
          this.emit('task-skip', { task: taskState.task.name, reason: s.status });
          continue;
        }

        // Check dependencies are all completed
        const deps = taskState.task.depends_on || [];
        const failedDep = deps.find(d => {
          const depState = this.stateManager.get(d);
          return depState.status !== 'completed';
        });
        if (failedDep) {
          taskState.status = 'failed';
          taskState.error = `Dependency "${failedDep}" not completed`;
          this.stateManager.markFailed(taskState.task.name, taskState.error);
          this.emit('task-skip', { task: taskState.task.name, reason: `dependency "${failedDep}" not completed` });
          continue;
        }
        await this.executeTask(taskState);
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

  // ─── Task Execution ─────────────────────────────────────────

  private async executeTask(taskState: TaskState): Promise<void> {
    const { task } = taskState;
    const detector = new RateLimitDetector();

    taskState.status = 'running';
    taskState.started_at = new Date().toISOString();
    taskState.container_id = this.containerId;
    this.stateManager.markRunning(task.name, this.runState.id);
    this.emit('task-start', task.name);

    const timeoutMinutes = task.settings?.timeout || this.options.timeout || 0;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let timeoutReject: ((err: Error) => void) | undefined;

    // Get git HEAD before task runs
    let headBefore = '';
    try {
      const { stream: headStream } = await this.docker.exec(this.containerId!, [
        'git', '-C', '/workspace', 'rev-parse', 'HEAD',
      ]);
      headBefore = await this.streamToString(headStream);
    } catch { /* git not initialized */ }

    try {
      // Build prompt: task + env vars + roadmap instruction
      let prompt = task.prompt;
      const env = this.config.get<Record<string, string>>('env');
      if (env && Object.keys(env).length > 0) {
        const names = Object.keys(env).join(', ');
        prompt += `\n\nEnvironment variables available: ${names}`;
      }


      // Write prompt into the container (via tar, no heredoc escaping issues)
      await this.docker.writeFile(this.containerId!, '/tmp/task-prompt.md', prompt);

      // Launch claude-wrapper — Claude Code does everything
      const { stream } = await this.docker.exec(this.containerId!, [
        '/usr/local/bin/claude-wrapper', '/tmp/task-prompt.md',
        this.options.overnight ? '999' : '10',
      ]);

      // Stream output (demultiplexed into stdout/stderr)
      const demuxed = demuxExecStream(stream);
      const streamPromise = new Promise<void>((resolve, reject) => {
        let output = '';

        demuxed.on('data', ({ type: streamType, data }: { type: 'stdout' | 'stderr'; data: string }) => {
          output += data;

          for (const line of data.split('\n').filter((l: string) => l.trim())) {
            const parsed = detector.parseLogLine(line);
            // For rate_limit/network_error keep the detector type; otherwise use the stream type
            const emitType = (parsed.type === 'rate_limit' || parsed.type === 'network_error')
              ? parsed.type
              : streamType;
            this.emit('task-output', { task: task.name, type: emitType, raw: parsed.raw });

            if (parsed.type === 'rate_limit') {
              taskState.status = 'waiting';
              taskState.rate_limits_hit++;
              this.emit('rate-limit', { task: task.name, count: taskState.rate_limits_hit });
            } else if (parsed.type === 'network_error') {
              taskState.status = 'waiting';
              taskState.network_errors++;
              this.emit('network-error', { task: task.name, count: taskState.network_errors });
            } else if (taskState.status === 'waiting') {
              taskState.status = 'running';
            }
          }
        });

        demuxed.on('end', () => {
          const logPath = path.join(this.getRunDir(), `${task.name}.log`);
          fs.writeFileSync(logPath, output, 'utf-8');
          resolve();
        });

        demuxed.on('error', reject);
      });

      const timeoutPromise = timeoutMinutes > 0
        ? new Promise<void>((_resolve, reject) => {
            timeoutReject = reject;
            timeoutHandle = setTimeout(async () => {
              taskState.status = 'failed';
              taskState.timed_out = true;
              taskState.error = `Task timed out after ${timeoutMinutes} minutes`;
              try {
                await this.docker.exec(this.containerId!, ['pkill', '-f', 'claude']);
              } catch { /* ignore — process may already be gone */ }
              this.emit('task-timeout', { task: task.name, timeout: timeoutMinutes });
              reject(new Error(taskState.error));
            }, timeoutMinutes * 60 * 1000);
          })
        : null;

      await (timeoutPromise ? Promise.race([streamPromise, timeoutPromise]) : streamPromise);

      // Check final status
      const statusJson = await this.docker.readFile(this.containerId!, '/tmp/klaude-status.json');
      let finalResolved = false;
      if (statusJson) {
        const containerStatus = detector.parseContainerStatus(statusJson);
        if (containerStatus?.status === 'completed') {
          taskState.status = 'completed';
          finalResolved = true;
        } else if (containerStatus?.status === 'failed') {
          taskState.status = 'failed';
          taskState.error = containerStatus.message;
          finalResolved = true;
        }
      }

      if (!finalResolved && taskState.status !== 'completed' && taskState.status !== 'failed') {
        taskState.status = 'completed';
      }

    } catch (err) {
      if (!taskState.timed_out) {
        taskState.status = 'failed';
        taskState.error = (err as Error).message;
        this.emit('task-error', { task: task.name, error: taskState.error });
      }
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      taskState.completed_at = new Date().toISOString();

      // Capture git diff for this task
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

        const diffPath = path.join(this.getRunDir(), `${task.name}.diff`);
        const diffContent = `# Git changes for task: ${task.name}\n\n## Commits\n${commitLog}\n\n## Diff\n${diff}`;
        fs.writeFileSync(diffPath, diffContent, 'utf-8');
      } catch { /* ignore git errors */ }

      // Persist task state
      if (taskState.status === 'completed') {
        this.stateManager.markCompleted(task.name);
      } else if (taskState.status === 'failed') {
        this.stateManager.markFailed(task.name, taskState.error);
      }

      const stats = detector.getStats();
      this.emit('task-done', {
        task: task.name,
        status: taskState.status,
        rateLimits: stats.rateLimitsHit,
        networkErrors: stats.networkErrors,
        waitTime: stats.totalWaitTimeMs,
      });
    }
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

    if (ageHours !== null && ageHours < maxAge) {
      this.emit('log', `Docker image "${imageName}" found (${Math.round(ageHours)}h old).`);
      return;
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
