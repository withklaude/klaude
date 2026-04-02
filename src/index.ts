#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { configSetCommand, configGetCommand, configListCommand } from './commands/config.js';
import { taskNewCommand, taskListCommand, taskShowCommand, taskValidateCommand, taskGenerateCommand, taskEditCommand, taskDeleteCommand, taskExampleCommand, taskResetCommand, taskSkipCommand, taskSuggestCommand } from './commands/task.js';
import { planCommand } from './commands/plan.js';
import { runCommand } from './commands/run.js';
import { statusCommand } from './commands/status.js';
import { stopCommand } from './commands/stop.js';
import { cleanCommand } from './commands/clean.js';
import { logsCommand } from './commands/logs.js';

// ─── Auto-update ────────────────────────────────────────────────
async function checkForUpdate(): Promise<void> {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json');
    const currentVersion = pkg.version;

    const latest = execSync('npm view klaude-tool version', {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (latest && latest !== currentVersion) {
      // Only update if npm version is newer (not older)
      const [aMaj, aMin, aPat] = currentVersion.split('.').map(Number);
      const [bMaj, bMin, bPat] = latest.split('.').map(Number);
      const npmIsNewer = bMaj > aMaj || (bMaj === aMaj && bMin > aMin) || (bMaj === aMaj && bMin === aMin && bPat > aPat);
      if (npmIsNewer) {
        console.log(`\x1b[33mUpdating klaude ${currentVersion} → ${latest}...\x1b[0m`);
        execSync('npm install -g klaude-tool@latest', {
          stdio: 'inherit',
          timeout: 60000,
        });
        console.log(`\x1b[32m✓ Updated to ${latest}\x1b[0m\n`);
      }
    }
  } catch {
    // Silently ignore — offline, no npm, etc.
  }
}

await checkForUpdate();

const program = new Command();

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

program
  .name('klaude')
  .description('Orchestrate Claude Code tasks in Docker containers — plan by day, run overnight')
  .version(pkg.version);

// ─── init ────────────────────────────────────────────────────────
program
  .command('init')
  .description('Initialize .klaude/ in the current project')
  .action(initCommand);

// ─── config ──────────────────────────────────────────────────────
const configCmd = program
  .command('config')
  .description('Manage credentials and settings');

configCmd
  .command('set <key> <value>')
  .description('Set a config value')
  .option('-g, --global', 'Set in global config (~/.klaude/config.yaml)')
  .action(configSetCommand);

configCmd
  .command('get <key>')
  .description('Get a config value')
  .action(configGetCommand);

configCmd
  .command('list')
  .description('List all config values')
  .action(configListCommand);

// ─── task ────────────────────────────────────────────────────────
const taskCmd = program
  .command('task')
  .description('Create, list, and manage tasks');

taskCmd
  .command('new')
  .description('Create a new task interactively')
  .action(taskNewCommand);

taskCmd
  .command('list')
  .description('List all tasks')
  .action(taskListCommand);

taskCmd
  .command('show <name>')
  .description('Show task details')
  .action(taskShowCommand);

taskCmd
  .command('validate')
  .description('Validate all tasks')
  .action(taskValidateCommand);

taskCmd
  .command('edit [name]')
  .description('Edit a task with Claude assistance or in editor')
  .action(taskEditCommand);

taskCmd
  .command('delete [name]')
  .description('Delete a task')
  .action(taskDeleteCommand);

taskCmd
  .command('generate [description]')
  .description('Generate a structured task using Claude from a natural language description')
  .action(taskGenerateCommand);

taskCmd
  .command('example')
  .description('Create an example task to see the format')
  .action(taskExampleCommand);

taskCmd
  .command('reset [name]')
  .description('Reset a task to pending (so it runs again)')
  .option('--all', 'Reset all tasks')
  .action(taskResetCommand);

taskCmd
  .command('skip [name]')
  .description('Mark a task as skipped (won\'t run)')
  .action(taskSkipCommand);

taskCmd
  .command('suggest [description]')
  .description('Suggest next task to work on, or analyze codebase for a given description')
  .action(taskSuggestCommand);

// ─── plan ───────────────────────────────────────────────────────
program
  .command('plan [spec-file]')
  .description('Analyze a spec file and create tasks with priorities')
  .option('-y, --yes', 'Skip confirmation and write tasks immediately')
  .option('--append', 'Add tasks to existing plan without overwriting')
  .option('--from-issues', 'Generate tasks from open GitHub issues')
  .action((specFile, options) => planCommand(specFile, options));

// ─── run ─────────────────────────────────────────────────────────
program
  .command('run [task-name]')
  .description('Run task(s) in Docker containers')
  .option('--all', 'Run all tasks')
  .option('--overnight', 'Overnight mode: run all tasks, never exit, drain all tokens')
  .option('--dry-run', 'Show what would happen without executing')
  .option('--resume', 'Resume an interrupted run')
  .option('--watch', 'Restart automatically when tasks change')
  .option('--no-notify', 'Disable completion notifications')
  .option('--timeout <minutes>', 'Maximum minutes per task', parseInt)
  .action(runCommand);

// ─── status ──────────────────────────────────────────────────────
program
  .command('status')
  .description('Show running containers and task progress')
  .option('--follow', 'Stream logs in real-time')
  .action(statusCommand);

// ─── stop ────────────────────────────────────────────────────────
program
  .command('stop [task-name]')
  .description('Stop running container(s)')
  .option('--all', 'Stop all containers')
  .action(stopCommand);

// ─── clean ───────────────────────────────────────────────────────
program
  .command('clean')
  .description('Remove old runs and orphan containers')
  .option('--runs-only', 'Only clean run directories')
  .option('--containers-only', 'Only clean containers')
  .option('--keep <number>', 'Number of recent runs to keep', '5')
  .option('--all', 'Remove all runs')
  .option('-y, --yes', 'Skip confirmation')
  .action(cleanCommand);

// ─── logs ────────────────────────────────────────────────────────
program
  .command('logs <task-name>')
  .description('Show logs from the last run for a task')
  .option('--run <run-id>', 'Show logs from a specific run')
  .option('-f, --follow', 'Follow log output in real-time')
  .option('-n, --lines <number>', 'Show last N lines')
  .option('--diff', 'Show git diff instead of log output')
  .action(logsCommand);

program.parse();
