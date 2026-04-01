import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { DockerManager } from '../core/docker.js';
import { ConfigManager } from '../core/config-manager.js';
import type { RunState } from '../types/index.js';

interface StatusOptions {
  follow?: boolean;
}

export async function statusCommand(opts: StatusOptions): Promise<void> {
  const config = new ConfigManager();
  const docker = new DockerManager();

  console.log(chalk.bold('\n📊 Klaude Status\n'));

  // ─── Running containers ────────────────────────────────────

  if (await docker.isAvailable()) {
    const containers = await docker.listContainers();
    if (containers.length > 0) {
      console.log(chalk.bold('  Active Containers:'));
      for (const c of containers) {
        const stateColor = c.state === 'running' ? chalk.green : chalk.yellow;
        console.log(`    ${stateColor('●')} ${c.task} — ${c.state} (${c.id.slice(0, 12)})`);
      }
      console.log('');
    } else {
      console.log(chalk.dim('  No active containers.\n'));
    }
  } else {
    console.log(chalk.yellow('  ⚠ Docker not available.\n'));
  }

  // ─── Latest run ────────────────────────────────────────────

  const projectDir = config.getProjectDir();
  if (!projectDir) {
    console.log(chalk.dim('  Not inside a klaude project.\n'));
    return;
  }

  const runsDir = path.join(projectDir, 'runs');
  if (!fs.existsSync(runsDir)) {
    console.log(chalk.dim('  No runs yet. Use "klaude run" to start.\n'));
    return;
  }

  // Find latest run
  const runDirs = fs.readdirSync(runsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort()
    .reverse();

  if (runDirs.length === 0) {
    console.log(chalk.dim('  No runs yet.\n'));
    return;
  }

  const latestRunDir = path.join(runsDir, runDirs[0]);
  const statePath = path.join(latestRunDir, 'state.json');

  if (fs.existsSync(statePath)) {
    const state: RunState = JSON.parse(fs.readFileSync(statePath, 'utf-8'));

    const isRunning = !state.completed_at;
    const mode = state.options.overnight ? 'overnight' : 'standard';

    console.log(chalk.bold('  Latest Run:'));
    console.log(`    ID:      ${state.id}`);
    console.log(`    Mode:    ${mode}`);
    console.log(`    Started: ${state.started_at}`);
    if (state.completed_at) {
      console.log(`    Ended:   ${state.completed_at}`);
    } else {
      console.log(`    Status:  ${chalk.green('running')}`);
    }
    console.log('');

    console.log(chalk.bold('  Tasks:'));
    for (const ts of state.tasks) {
      let icon: string;
      let statusText: string;
      switch (ts.status) {
        case 'completed':
          icon = chalk.green('✓');
          statusText = chalk.green('completed');
          break;
        case 'failed':
          icon = chalk.red('✗');
          statusText = chalk.red('failed');
          break;
        case 'running':
          icon = chalk.cyan('●');
          statusText = chalk.cyan('running');
          break;
        case 'waiting':
          icon = chalk.yellow('⏳');
          statusText = chalk.yellow('waiting (rate limit / network)');
          break;
        default:
          icon = chalk.dim('○');
          statusText = chalk.dim('pending');
      }

      const rl = ts.rate_limits_hit > 0 ? chalk.yellow(` RL:${ts.rate_limits_hit}`) : '';
      const net = ts.network_errors > 0 ? chalk.red(` NET:${ts.network_errors}`) : '';
      console.log(`    ${icon} ${ts.task.name} — ${statusText}${rl}${net}`);

      if (ts.error) {
        console.log(`      ${chalk.red(ts.error)}`);
      }
    }

    const totalRL = state.tasks.reduce((s, t) => s + t.rate_limits_hit, 0);
    const totalNet = state.tasks.reduce((s, t) => s + t.network_errors, 0);
    console.log('');
    if (totalRL > 0 || totalNet > 0) {
      console.log(`  Totals: rate limits ${totalRL}, network errors ${totalNet}`);
    }

    // Follow mode: tail the latest log
    if (opts.follow && isRunning) {
      const runningTask = state.tasks.find(t => t.status === 'running' || t.status === 'waiting');
      if (runningTask) {
        const logFile = path.join(latestRunDir, `${runningTask.task.name}.log`);
        console.log(chalk.dim(`\n  Tailing ${logFile}...\n`));

        // Simple tail -f equivalent
        if (fs.existsSync(logFile)) {
          let pos = 0;
          const interval = setInterval(() => {
            try {
              const stat = fs.statSync(logFile);
              if (stat.size > pos) {
                const fd = fs.openSync(logFile, 'r');
                const buf = Buffer.alloc(stat.size - pos);
                fs.readSync(fd, buf, 0, buf.length, pos);
                fs.closeSync(fd);
                process.stdout.write(buf.toString('utf-8'));
                pos = stat.size;
              }
            } catch { /* file may be in flux */ }
          }, 1000);

          // Stop on Ctrl+C
          process.on('SIGINT', () => {
            clearInterval(interval);
            console.log('');
            process.exit(0);
          });

          // Keep running
          await new Promise(() => {}); // never resolves, stopped by SIGINT
        }
      }
    }
  }

  console.log('');
}
