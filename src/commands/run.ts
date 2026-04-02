import fs from 'node:fs';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import ora from 'ora';
import { ContainerRunner } from '../core/container-runner.js';
import { ConfigManager } from '../core/config-manager.js';
import { sendWebhooks, formatRunPayload } from '../core/webhook.js';
import type { RunOptions, RunState, WebhookConfig } from '../types/index.js';

interface RunCommandOptions {
  all?: boolean;
  overnight?: boolean;
  dryRun?: boolean;
  resume?: boolean;
  watch?: boolean;
  rebuild?: boolean;
  notify?: boolean;
  timeout?: number;
}

function sendNotification(title: string, message: string): void {
  try {
    // Bell sound for terminal (works everywhere)
    process.stdout.write('\x07');
  } catch {
    // ignore
  }
  try {
    if (process.platform === 'darwin') {
      const escaped = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      execSync(`osascript -e 'display notification "${escaped}" with title "${title}"'`, { stdio: 'ignore' });
    } else if (process.platform === 'linux') {
      execSync(`notify-send "${title}" "${message}"`, { stdio: 'ignore' });
    } else if (process.platform === 'win32') {
      // Windows: use subtle toast notification (non-blocking, bottom-right)
      // Only try if Windows 10+ (has UWP toast support)
      try {
        const payload = {
          title,
          message,
        };
        const ps = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications.ToastNotificationManager] | Out-Null
[Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications.ToastNotification] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument] | Out-Null

$APP_ID = 'klaude'
$template = @"
<toast>
  <visual>
    <binding template="ToastText02">
      <text id="1">${title}</text>
      <text id="2">${message}</text>
    </binding>
  </visual>
</toast>
"@
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml($template)
$toast = New-Object Windows.UI.Notifications.ToastNotification $xml
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($APP_ID).Show($toast)
`;
        execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`, { stdio: 'ignore', timeout: 2000 });
      } catch {
        // Fallback to nothing if toast fails (at least we have the bell)
      }
    }
  } catch {
    // Silently ignore — notification may not be available
  }
}

async function doRun(options: RunOptions, taskNames: string[] | undefined, spinner: ReturnType<typeof ora>, notify = true, runner?: ContainerRunner): Promise<{ runner: ContainerRunner; exitCode: number; result?: RunState }> {
  if (!runner) runner = new ContainerRunner(options);

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
      const trimmed = raw.trim();
      if (trimmed.length > 0) {
        console.log(chalk.dim(trimmed));
      }
    }
  });

  runner.on('task-timeout', ({ task, timeout }: { task: string; timeout: number }) => {
    console.log(chalk.red(`⏰ [${task}] Timed out after ${timeout} minutes`));
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

  try {
    spinner.start('Preparing run...');
    const result = await runner.run(taskNames);
    spinner.stop();

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

    if (notify) {
      const msg = `${completed}/${total} tasks completed${failed > 0 ? `, ${failed} failed` : ''}`;
      sendNotification('klaude', msg);
    }

    const webhooks = new ConfigManager().get<WebhookConfig[]>('webhooks') || [];
    if (webhooks.length > 0) {
      await sendWebhooks(webhooks, 'run_complete', formatRunPayload(result));
    }

    return { runner, exitCode: failed > 0 ? 1 : 0, result };
  } catch (err) {
    spinner.fail((err as Error).message);
    return { runner, exitCode: 1 };
  }
}

export async function runCommand(taskName: string | undefined, opts: RunCommandOptions): Promise<void> {
  const options: RunOptions = {
    overnight: opts.overnight || false,
    dryRun: opts.dryRun || false,
    resume: opts.resume || false,
    watch: opts.watch || false,
    rebuild: opts.rebuild || false,
    timeout: opts.timeout,
  };

  // --watch implies --all
  const taskNames = taskName ? [taskName] : undefined;

  if (!taskName && !opts.all && !opts.overnight && !opts.watch && !opts.resume) {
    console.error(chalk.red('Specify a task name, --all, or --overnight.'));
    console.log(chalk.dim('  klaude run <task-name>'));
    console.log(chalk.dim('  klaude run --all'));
    console.log(chalk.dim('  klaude run --overnight'));
    process.exit(1);
  }

  const spinner = ora();

  // ─── Execute ─────────────────────────────────────────────────

  console.log(chalk.bold(`\n🚀 Klaude Run${options.overnight ? ' (overnight mode)' : options.watch ? ' (watch mode)' : ''}\n`));

  if (options.overnight) {
    console.log(chalk.dim('  Overnight mode: will drain all tokens, waiting on rate limits.'));
    console.log(chalk.dim('  Press Ctrl+C to stop gracefully.\n'));
  }

  if (options.watch) {
    console.log(chalk.dim('  Watch mode: will restart automatically when tasks change.'));
    console.log(chalk.dim('  Press Ctrl+C to stop gracefully.\n'));
  }

  // Handle graceful shutdown — stop the container on Ctrl+C
  let stopping = false;
  let currentRunner: ContainerRunner | null = null;

  process.on('SIGINT', async () => {
    if (stopping) {
      console.log(chalk.red('\nForce stopping...'));
      process.exit(1);
    }
    stopping = true;
    spinner.stop();
    console.log(chalk.yellow('\n⏹ Stopping container...'));
    if (currentRunner) await currentRunner.shutdown();
    process.exit(130);
  });

  // In watch mode, always run all tasks
  const runTaskNames = options.watch ? undefined : (opts.all ? undefined : taskNames);

  // Create runner before doRun so SIGINT can reach it during execution
  currentRunner = new ContainerRunner(options);
  const { exitCode } = await doRun(options, runTaskNames, spinner, opts.notify !== false, currentRunner);

  if (!options.watch) {
    if (exitCode !== 0) process.exit(exitCode);
    return;
  }

  // ─── Watch mode ───────────────────────────────────────────────

  const config = new ConfigManager();
  const tasksDir = config.getTasksDir();

  if (!tasksDir) {
    console.error(chalk.red('No tasks directory found. Run `klaude init` first.'));
    process.exit(1);
  }

  const watchedExtensions = new Set(['.md', '.yaml', '.yml', '.json']);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let restarting = false;

  console.log(chalk.dim(`\n  Watching ${tasksDir} for changes...\n`));

  fs.watch(tasksDir, { recursive: true }, (event, filename) => {
    if (stopping || restarting) return;
    if (!filename) return;

    const ext = filename.slice(filename.lastIndexOf('.'));
    if (!watchedExtensions.has(ext)) return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      if (stopping) return;
      restarting = true;
      console.log(chalk.yellow(`\n♻ Tasks changed (${filename}) — restarting run...\n`));
      spinner.stop();
      await currentRunner?.shutdown();
      currentRunner = new ContainerRunner(options);
      await doRun(options, undefined, spinner, opts.notify !== false, currentRunner);
      restarting = false;
    }, 500);
  });
}
