import fs from 'node:fs';
import path from 'node:path';
import { confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import { ConfigManager } from '../core/config-manager.js';
import { DockerManager } from '../core/docker.js';

export interface CleanOptions {
  runsOnly?: boolean;
  containersOnly?: boolean;
  keep?: string;
  all?: boolean;
  yes?: boolean;
}

export async function cleanCommand(opts: CleanOptions): Promise<void> {
  const keepCount = opts.all ? 0 : parseInt(opts.keep ?? '5', 10);

  let removedRuns = 0;
  let removedContainers = 0;

  // ─── Runs ────────────────────────────────────────────────────────
  if (!opts.containersOnly) {
    const config = new ConfigManager();
    const projectDir = config.getProjectDir();

    if (!projectDir) {
      console.log(chalk.yellow('No klaude project found — skipping run cleanup.'));
    } else {
      const runsDir = path.join(projectDir, 'runs');

      if (!fs.existsSync(runsDir)) {
        console.log(chalk.dim('No runs directory found.'));
      } else {
        const entries = fs.readdirSync(runsDir, { withFileTypes: true })
          .filter(e => e.isDirectory())
          .map(e => e.name)
          .sort();

        const toDelete = opts.all ? entries : entries.slice(0, Math.max(0, entries.length - keepCount));

        if (toDelete.length === 0) {
          console.log(chalk.dim(`No run directories to remove (keeping ${keepCount} most recent).`));
        } else {
          console.log(chalk.bold(`\nRun directories to remove (${toDelete.length}):`));
          for (const name of toDelete) {
            console.log(`  ${chalk.red(name)}`);
          }

          const proceed = opts.yes || await confirm({
            message: `Remove ${toDelete.length} run director${toDelete.length === 1 ? 'y' : 'ies'}?`,
            default: false,
          });

          if (proceed) {
            for (const name of toDelete) {
              fs.rmSync(path.join(runsDir, name), { recursive: true, force: true });
              removedRuns++;
            }
            console.log(chalk.green(`✓ Removed ${removedRuns} run director${removedRuns === 1 ? 'y' : 'ies'}.`));
          } else {
            console.log(chalk.dim('Skipped run cleanup.'));
          }
        }
      }
    }
  }

  // ─── Containers ──────────────────────────────────────────────────
  if (!opts.runsOnly) {
    const docker = new DockerManager();

    const available = await docker.isAvailable();
    if (!available) {
      console.log(chalk.yellow('\nDocker not available — skipping container cleanup.'));
    } else {
      let containers: Array<{ id: string; name: string; task: string; state: string }>;
      try {
        containers = await docker.listContainers();
      } catch (err) {
        console.log(chalk.yellow(`\nCould not list containers: ${(err as Error).message}`));
        containers = [];
      }

      const orphans = containers.filter(c => c.state !== 'running');

      if (orphans.length === 0) {
        console.log(chalk.dim('\nNo orphan containers found.'));
      } else {
        console.log(chalk.bold(`\nOrphan containers to remove (${orphans.length}):`));
        for (const c of orphans) {
          console.log(`  ${chalk.red(c.name)} ${chalk.dim(`[${c.state}]  task: ${c.task}`)}`);
        }

        const proceed = opts.yes || await confirm({
          message: `Stop and remove ${orphans.length} orphan container${orphans.length === 1 ? '' : 's'}?`,
          default: false,
        });

        if (proceed) {
          for (const c of orphans) {
            try {
              await docker.stopContainer(c.id);
              await docker.removeContainer(c.id);
              removedContainers++;
            } catch (err) {
              console.log(chalk.yellow(`  Warning: could not remove ${c.name}: ${(err as Error).message}`));
            }
          }
          console.log(chalk.green(`✓ Removed ${removedContainers} container${removedContainers === 1 ? '' : 's'}.`));
        } else {
          console.log(chalk.dim('Skipped container cleanup.'));
        }
      }
    }
  }

  // ─── Summary ─────────────────────────────────────────────────────
  console.log(chalk.bold(`\nDone. Removed ${removedRuns} run${removedRuns === 1 ? '' : 's'} and ${removedContainers} container${removedContainers === 1 ? '' : 's'}.`));
}
