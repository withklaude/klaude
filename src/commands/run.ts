import chalk from 'chalk';
import ora from 'ora';
import { ContainerRunner } from '../core/container-runner.js';
import type { RunOptions, RunState } from '../types/index.js';

interface RunCommandOptions {
  all?: boolean;
  overnight?: boolean;
  dryRun?: boolean;
  resume?: boolean;
}

export async function runCommand(taskName: string | undefined, opts: RunCommandOptions): Promise<void> {
  const options: RunOptions = {
    overnight: opts.overnight || false,
    dryRun: opts.dryRun || false,
    resume: opts.resume || false,
  };

  const taskNames = taskName ? [taskName] : undefined;

  if (!taskName && !opts.all && !opts.overnight) {
    console.error(chalk.red('Specify a task name, --all, or --overnight.'));
    console.log(chalk.dim('  klaude run <task-name>'));
    console.log(chalk.dim('  klaude run --all'));
    console.log(chalk.dim('  klaude run --overnight'));
    process.exit(1);
  }

  const runner = new ContainerRunner(options);
  const spinner = ora();

  // ─── Event listeners ─────────────────────────────────────────

  runner.on('log', (msg: string) => {
    spinner.info(msg);
    spinner.start();
  });

  runner.on('build-log', (msg: string) => {
    if (msg.trim()) spinner.text = chalk.dim(`[build] ${msg}`);
  });

  runner.on('task-start', (name: string) => {
    spinner.stop();
    console.log(chalk.bold(`\n── ${name} ──────────────────────────────────\n`));
  });

  runner.on('task-output', ({ task, type, raw }: { task: string; type: string; raw: string }) => {
    if (type === 'rate_limit') {
      console.log(chalk.yellow(`\n⏳ [${task}] Rate limit hit — waiting for reset...\n`));
    } else if (type === 'network_error') {
      console.log(chalk.red(`\n🌐 [${task}] Network error — waiting...\n`));
    } else if (type === 'stderr') {
      const trimmed = raw.trim();
      if (trimmed.length > 0) {
        console.log(chalk.red('│ ') + chalk.redBright(trimmed));
      }
    } else {
      // stdout — stream Claude's output directly to console
      const trimmed = raw.trim();
      if (trimmed.length > 0) {
        console.log(chalk.dim(trimmed));
      }
    }
  });

  runner.on('task-done', ({ task, status, rateLimits, networkErrors, waitTime }: {
    task: string; status: string; rateLimits: number; networkErrors: number; waitTime: number;
  }) => {
    const icon = status === 'completed' ? chalk.green('✓') : chalk.red('✗');
    const waitStr = waitTime > 0 ? chalk.dim(` (waited ${Math.round(waitTime / 1000)}s)`) : '';
    const rlStr = rateLimits > 0 ? chalk.yellow(` RL:${rateLimits}`) : '';
    const netStr = networkErrors > 0 ? chalk.red(` NET:${networkErrors}`) : '';
    console.log(`\n${icon} ${task} — ${status}${rlStr}${netStr}${waitStr}`);
  });

  runner.on('dry-run', (state: RunState) => {
    console.log(chalk.bold('\n🔍 Dry Run — would execute:\n'));
    for (const ts of state.tasks) {
      console.log(`  ${chalk.cyan(ts.task.name)}`);
      console.log(`    ${chalk.dim(ts.task.prompt.split('\n')[0].slice(0, 80))}`);
    }
    console.log(`\n  Mode: ${state.options.overnight ? 'overnight' : 'standard'}`);
    console.log('');
  });

  // ─── Execute ─────────────────────────────────────────────────

  console.log(chalk.bold(`\n🚀 Klaude Run${options.overnight ? ' (overnight mode)' : ''}\n`));

  if (options.overnight) {
    console.log(chalk.dim('  Overnight mode: will drain all tokens, waiting on rate limits.'));
    console.log(chalk.dim('  Press Ctrl+C to stop gracefully.\n'));
  }

  // Handle graceful shutdown — stop the container on Ctrl+C
  let stopping = false;
  process.on('SIGINT', async () => {
    if (stopping) {
      console.log(chalk.red('\nForce stopping...'));
      process.exit(1);
    }
    stopping = true;
    spinner.stop();
    console.log(chalk.yellow('\n⏹ Stopping container...'));
    await runner.shutdown();
    process.exit(130);
  });

  try {
    spinner.start('Preparing run...');
    const result = await runner.run(opts.all ? undefined : taskNames);
    spinner.stop();

    // Summary
    const completed = result.tasks.filter(t => t.status === 'completed').length;
    const failed = result.tasks.filter(t => t.status === 'failed').length;
    const total = result.tasks.length;

    console.log(chalk.bold(`\n📊 Run Complete\n`));
    console.log(`  Tasks: ${completed}/${total} completed${failed > 0 ? `, ${failed} failed` : ''}`);

    const totalRL = result.tasks.reduce((s, t) => s + t.rate_limits_hit, 0);
    const totalNet = result.tasks.reduce((s, t) => s + t.network_errors, 0);
    if (totalRL > 0) console.log(`  Rate limits hit: ${totalRL}`);
    if (totalNet > 0) console.log(`  Network errors: ${totalNet}`);

    if (result.completed_at) {
      const start = new Date(result.started_at);
      const end = new Date(result.completed_at);
      const mins = Math.round((end.getTime() - start.getTime()) / 60_000);
      console.log(`  Duration: ${mins} minutes`);
    }

    console.log(chalk.dim(`  Report: .klaude/runs/${result.id}/report.md`));
    console.log('');

    if (failed > 0) process.exit(1);
  } catch (err) {
    spinner.fail((err as Error).message);
    process.exit(1);
  }
}
