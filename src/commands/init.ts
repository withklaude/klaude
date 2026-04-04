import fs from 'node:fs';
import path from 'node:path';
import { input, confirm, select, editor } from '@inquirer/prompts';
import chalk from 'chalk';
import YAML from 'yaml';
import { ConfigManager } from '../core/config-manager.js';

/** Get the path to a bundled template file */
function getTemplatePath(filename: string): string {
  return path.join(
    path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')),
    '..', 'templates', filename,
  );
}

export async function initCommand(): Promise<void> {
  const cwd = process.cwd();
  const klaudeDir = path.join(cwd, '.klaude');

  if (fs.existsSync(klaudeDir)) {
    console.log(chalk.yellow('⚠ .klaude/ already exists in this directory.'));
    const overwrite = await confirm({ message: 'Reinitialize?', default: false });
    if (!overwrite) {
      console.log('Aborted.');
      return;
    }
  }

  console.log(chalk.bold('\n🔧 Initializing klaude project...\n'));

  const config = new ConfigManager();
  const dir = config.initProject(cwd);
  console.log(chalk.green(`✓ Created ${path.relative(cwd, dir)}/`));

  // Install Claude Code agent helper
  installClaudeAgent(cwd);

  // ─── 1. Authentication ─────────────────────────────────────
  console.log(chalk.bold('\n📋 1/4 — Authentication\n'));

  const apiKey = config.resolveApiKey();
  if (apiKey) {
    console.log(chalk.green('✓ API key detected from host (Claude Code / env)'));
  } else {
    const oauth = config.detectClaudeOAuth();
    if (oauth.found) {
      const sub = oauth.subscriptionType ? ` (${oauth.subscriptionType})` : '';
      console.log(chalk.green(`✓ Claude OAuth token detected${sub} — no API key needed`));
      console.log(chalk.dim('  The ~/.claude/ directory will be mounted in the container.'));
    } else {
      console.log(chalk.yellow('⚠ No Anthropic API key or Claude OAuth token found.'));
      const setKey = await confirm({ message: 'Set API key now?', default: true });
      if (setKey) {
        const key = await input({ message: 'Anthropic API key:' });
        if (key.trim()) {
          config.setGlobal('anthropic.api_key', key.trim());
          console.log(chalk.green('✓ API key saved to global config'));
        }
      }
    }
  }

  // ─── 2. Git ────────────────────────────────────────────────
  console.log(chalk.bold('\n📋 2/4 — Git\n'));
  console.log(chalk.dim('  Used inside the container for commits and pushes.\n'));

  const gitUser = await input({ message: 'Git username:', default: 'klaude' });
  if (gitUser.trim()) config.setGlobal('git.user', gitUser.trim());

  const gitEmail = await input({ message: 'Git email:', default: 'klaude@automated' });
  if (gitEmail.trim()) config.setGlobal('git.email', gitEmail.trim());

  const setToken = await confirm({ message: 'Configure Git token? (needed for push)', default: false });
  if (setToken) {
    const token = await input({ message: 'Git token (GitHub/GitLab):' });
    if (token.trim()) {
      config.setGlobal('git.token', token.trim());
      console.log(chalk.green('✓ Git token saved'));
    }
  }

  // ─── 3. Agent Behavior ─────────────────────────────────────
  console.log(chalk.bold('\n📋 3/4 — Agent behavior\n'));
  console.log(chalk.dim('  Controls how the agent works inside the container.\n'));

  const agentConfig = await setupAgentConfig();

  const agentYamlPath = path.join(klaudeDir, 'agent.yaml');
  fs.writeFileSync(agentYamlPath, YAML.stringify(agentConfig), 'utf-8');
  console.log(chalk.green('✓ Agent config saved (.klaude/agent.yaml)'));

  // ─── 4. Docker & Environment ───────────────────────────────
  console.log(chalk.bold('\n📋 4/4 — Docker & Environment\n'));

  const dockerMemory = await input({ message: 'Container memory limit:', default: '4g' });
  config.setProject('docker.memory', dockerMemory.trim());

  const dockerCpus = await input({ message: 'Container CPU limit:', default: '2' });
  config.setProject('docker.cpus', Number(dockerCpus.trim()) || 2);

  console.log(chalk.dim('\n  Environment variables available to Claude inside the container.\n'));
  let addMore = await confirm({ message: 'Add environment variables?', default: false });
  while (addMore) {
    const name = await input({ message: 'Variable name:' });
    const value = await input({ message: `Value for ${name.trim()}:` });
    if (name.trim() && value.trim()) {
      config.setProject(`env.${name.trim()}`, value.trim());
      console.log(chalk.green(`✓ ${name.trim()} saved`));
    }
    addMore = await confirm({ message: 'Add another?', default: false });
  }

  // Claude Code config detection
  const claudeDir = config.getClaudeConfigDir();
  if (claudeDir) {
    console.log(chalk.green(`\n✓ Claude Code config found at ${claudeDir} (will be mounted in container)`));
  }

  // ─── Done ──────────────────────────────────────────────────
  console.log(chalk.bold('\n✅ klaude initialized!\n'));
  console.log('Next steps:');
  console.log(`  ${chalk.cyan('klaude task new')}        — create a task`);
  console.log(`  ${chalk.cyan('klaude task generate')}   — generate task with Claude`);
  console.log(`  ${chalk.cyan('klaude run --overnight')} — run all tasks overnight`);
  console.log('');
}

// ─── Agent Config Setup ────────────────────────────────────────

interface AgentConfig {
  agent: {
    language: string;
    on_error: string;
    auto_commit: boolean;
    commit_style?: string;
    commit_prefix?: string;
    branch_strategy: string;
    branch_prefix?: string;
    auto_push: boolean;
    run_tests: boolean;
    test_command?: string;
    protected_paths?: string[];
    custom_instructions?: string;
  };
}

async function setupAgentConfig(): Promise<AgentConfig> {
  // Language
  const language = await select({
    message: 'Agent language:',
    choices: [
      { name: 'English', value: 'english' },
      { name: 'Italiano', value: 'italiano' },
      { name: 'Español', value: 'spanish' },
      { name: 'Français', value: 'french' },
      { name: 'Deutsch', value: 'german' },
      { name: 'Português', value: 'portuguese' },
      { name: '日本語 (Japanese)', value: 'japanese' },
      { name: '中文 (Chinese)', value: 'chinese' },
      { name: '한국어 (Korean)', value: 'korean' },
      { name: 'Русский (Russian)', value: 'russian' },
      { name: 'العربية (Arabic)', value: 'arabic' },
      { name: 'हिन्दी (Hindi)', value: 'hindi' },
      { name: 'Nederlands', value: 'dutch' },
      { name: 'Polski', value: 'polish' },
      { name: 'Türkçe', value: 'turkish' },
      { name: 'Auto (follow task language)', value: 'auto' },
    ],
    default: 'english',
  });

  // Error handling
  const onError = await select({
    message: 'When a task fails:',
    choices: [
      { name: 'Continue with remaining tasks', value: 'continue' },
      { name: 'Stop immediately', value: 'stop' },
    ],
    default: 'continue',
  });

  // Git: commits
  const autoCommit = await confirm({
    message: 'Auto-commit after each task?',
    default: false,
  });

  let commitStyle = 'conventional';
  let commitPrefix = '';
  if (autoCommit) {
    commitStyle = await select({
      message: 'Commit message style:',
      choices: [
        { name: 'Conventional (feat:, fix:, chore:, ...)', value: 'conventional' },
        { name: 'Free form', value: 'free' },
        { name: 'Custom prefix', value: 'prefix' },
      ],
      default: 'conventional',
    }) as string;

    if (commitStyle === 'prefix') {
      commitPrefix = await input({ message: 'Commit prefix:', default: '[klaude]' });
    }
  }

  // Git: branches
  const branchStrategy = await select({
    message: 'Branch strategy:',
    choices: [
      { name: 'Work on current branch', value: 'current' },
      { name: 'Create a branch per task (e.g. klaude/task-name)', value: 'per-task' },
      { name: 'Create a branch per run (e.g. klaude/run-2026-04-02)', value: 'per-run' },
    ],
    default: 'current',
  });

  let branchPrefix = '';
  if (branchStrategy !== 'current') {
    branchPrefix = await input({ message: 'Branch prefix:', default: 'klaude/' });
  }

  // Git: push
  const autoPush = await confirm({
    message: 'Auto-push after completing tasks?',
    default: false,
  });

  // Testing
  const runTests = await confirm({
    message: 'Run tests after each task?',
    default: false,
  });

  let testCommand = '';
  if (runTests) {
    testCommand = await input({ message: 'Test command:', default: 'npm test' });
  }

  // Protected paths
  const hasProtected = await confirm({
    message: 'Restrict access to certain paths?',
    default: false,
  });

  const protectedPaths: string[] = [];
  if (hasProtected) {
    const pathsText = await editor({
      message: 'Protected paths (one per line):',
      default: 'legacy/\n.env\n',
      postfix: '.txt',
    });
    for (const line of pathsText.split('\n')) {
      if (line.trim()) protectedPaths.push(line.trim());
    }
  }

  // Custom instructions
  const hasCustom = await confirm({
    message: 'Add custom instructions for the agent?',
    default: false,
  });

  let customInstructions = '';
  if (hasCustom) {
    customInstructions = await editor({
      message: 'Custom instructions (multiline):',
      default: '',
      postfix: '.md',
    });
  }

  // Build config object
  const config: AgentConfig = {
    agent: {
      language,
      on_error: onError,
      auto_commit: autoCommit,
      branch_strategy: branchStrategy,
      auto_push: autoPush,
      run_tests: runTests,
    },
  };

  if (autoCommit) {
    config.agent.commit_style = commitStyle;
    if (commitPrefix) config.agent.commit_prefix = commitPrefix;
  }

  if (branchPrefix) config.agent.branch_prefix = branchPrefix;
  if (testCommand) config.agent.test_command = testCommand;
  if (protectedPaths.length > 0) config.agent.protected_paths = protectedPaths;
  if (customInstructions.trim()) config.agent.custom_instructions = customInstructions.trim();

  return config;
}

// ─── Helpers ───────────────────────────────────────────────────

/** Install the klaude agent into .claude/agents/ so Claude Code can use it */
function installClaudeAgent(projectRoot: string): void {
  const agentSrc = getTemplatePath('claude-agent.md');
  if (!fs.existsSync(agentSrc)) return;

  const agentsDir = path.join(projectRoot, '.claude', 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });

  const agentDest = path.join(agentsDir, 'klaude.md');
  fs.copyFileSync(agentSrc, agentDest);
  console.log(chalk.green('✓ Claude Code agent installed (.claude/agents/klaude.md)'));
}
