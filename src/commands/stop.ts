import chalk from 'chalk';
import ora from 'ora';
import { DockerManager } from '../core/docker.js';

interface StopOptions {
  all?: boolean;
}

export async function stopCommand(taskName: string | undefined, opts: StopOptions): Promise<void> {
  const docker = new DockerManager();

  if (!await docker.isAvailable()) {
    console.error(chalk.red('Docker is not available.'));
    process.exit(1);
  }

  const containers = await docker.listContainers();

  if (containers.length === 0) {
    console.log(chalk.dim('No running klaude containers.'));
    return;
  }

  let toStop = containers;

  if (taskName && !opts.all) {
    toStop = containers.filter(c => c.task === taskName);
    if (toStop.length === 0) {
      console.error(chalk.red(`No container found for task "${taskName}".`));
      console.log(chalk.dim('Running containers:'));
      for (const c of containers) {
        console.log(chalk.dim(`  - ${c.task} (${c.state})`));
      }
      process.exit(1);
    }
  }

  const spinner = ora(`Stopping ${toStop.length} container(s)...`).start();

  for (const container of toStop) {
    try {
      spinner.text = `Stopping ${container.task}...`;
      await docker.stopContainer(container.id);
      await docker.removeContainer(container.id);
      spinner.succeed(`Stopped ${container.task}`);
    } catch (err) {
      spinner.warn(`Failed to stop ${container.task}: ${(err as Error).message}`);
    }
  }

  console.log(chalk.green(`\n✓ ${toStop.length} container(s) stopped.\n`));
}
