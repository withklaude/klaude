import fs from 'node:fs';
import path from 'node:path';
import { input, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
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

  // Init project structure
  const dir = config.initProject(cwd);
  console.log(chalk.green(`✓ Created ${path.relative(cwd, dir)}/`));

  // Install Claude Code agent
  installClaudeAgent(cwd);

  // Check API key
  const apiKey = config.resolveApiKey();
  if (apiKey) {
    console.log(chalk.green('✓ API key detected from host (Claude Code / env)'));
  } else {
    console.log(chalk.yellow('⚠ No Anthropic API key found.'));
    const setKey = await confirm({ message: 'Set API key now?', default: true });
    if (setKey) {
      const key = await input({ message: 'Anthropic API key:' });
      if (key.trim()) {
        config.setGlobal('anthropic.api_key', key.trim());
        console.log(chalk.green('✓ API key saved to global config'));
      }
    }
  }

  // Git config (used inside the container so Claude can commit/push)
  console.log(chalk.dim('\n  Git config is used inside the container so Claude can commit and push.\n'));

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

  // Extra env vars
  console.log(chalk.dim('\n  Environment variables available to Claude inside the container (e.g. NPM_TOKEN, SONAR_TOKEN).\n'));

  let addMore = await confirm({ message: 'Add environment variables?', default: false });
  while (addMore) {
    const name = await input({ message: 'Variable name:' });
    const value = await input({ message: `Value for ${name.trim()}:` });
    if (name.trim() && value.trim()) {
      config.setGlobal(`env.${name.trim()}`, value.trim());
      console.log(chalk.green(`✓ ${name.trim()} saved`));
    }
    addMore = await confirm({ message: 'Add another?', default: false });
  }

  // Claude Code config
  const claudeDir = config.getClaudeConfigDir();
  if (claudeDir) {
    console.log(chalk.green(`✓ Claude Code config found at ${claudeDir} (will be mounted in container)`));
  }

  console.log(chalk.bold('\n✅ klaude initialized!\n'));
  console.log('Next steps:');
  console.log(`  ${chalk.cyan('klaude task new')}        — create a task`);
  console.log(`  ${chalk.cyan('klaude task generate')}   — generate task with Claude`);
  console.log(`  ${chalk.cyan('klaude run --overnight')} — run all tasks overnight`);
  console.log('');
  console.log(chalk.dim('  Claude Code agent installed: use /klaude in Claude Code for guided help'));
  console.log('');
}

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
