import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { ConfigManager } from '../core/config-manager.js';

interface LogsOptions {
  run?: string;
  follow?: boolean;
  lines?: string;
}

export async function logsCommand(taskName: string, opts: LogsOptions): Promise<void> {
  const config = new ConfigManager();
  const projectDir = config.getProjectDir();

  if (!projectDir) {
    console.error(chalk.red('Not inside a klaude project.'));
    process.exit(1);
  }

  const runsDir = path.join(projectDir, 'runs');
  if (!fs.existsSync(runsDir)) {
    console.error(chalk.red(`No logs found for task "${taskName}"`));
    process.exit(1);
  }

  let runDirName: string;

  if (opts.run) {
    runDirName = opts.run;
    if (!fs.existsSync(path.join(runsDir, runDirName))) {
      console.error(chalk.red(`Run "${opts.run}" not found.`));
      process.exit(1);
    }
  } else {
    const runDirs = fs.readdirSync(runsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort()
      .reverse();

    if (runDirs.length === 0) {
      console.error(chalk.red(`No logs found for task "${taskName}"`));
      process.exit(1);
    }

    runDirName = runDirs[0];
  }

  const logFile = path.join(runsDir, runDirName, `${taskName}.log`);

  if (!fs.existsSync(logFile)) {
    console.error(chalk.red(`No logs found for task "${taskName}"`));
    process.exit(1);
  }

  const maxLines = opts.lines !== undefined ? parseInt(opts.lines, 10) : undefined;

  if (maxLines !== undefined && isNaN(maxLines)) {
    console.error(chalk.red(`Invalid value for --lines: "${opts.lines}"`));
    process.exit(1);
  }

  // Read and print initial content
  const content = fs.readFileSync(logFile, 'utf-8');
  const lines = content.split('\n');

  // Remove trailing empty line from split
  const outputLines = lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
  const sliced = maxLines !== undefined ? outputLines.slice(-maxLines) : outputLines;
  if (sliced.length > 0) {
    process.stdout.write(sliced.join('\n') + '\n');
  }

  if (!opts.follow) return;

  // Follow mode: tail the log file
  let pos = fs.statSync(logFile).size;

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

  process.on('SIGINT', () => {
    clearInterval(interval);
    console.log('');
    process.exit(0);
  });

  // Keep running until SIGINT
  await new Promise(() => {});
}
