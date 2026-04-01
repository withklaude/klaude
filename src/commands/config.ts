import chalk from 'chalk';
import { ConfigManager } from '../core/config-manager.js';

export function configSetCommand(keyPath: string, value: string, options: { global?: boolean }): void {
  const config = new ConfigManager();

  // Parse value: try number, boolean, then string
  let parsed: unknown = value;
  if (value === 'true') parsed = true;
  else if (value === 'false') parsed = false;
  else if (!isNaN(Number(value)) && value.trim() !== '') parsed = Number(value);

  try {
    if (options.global) {
      config.setGlobal(keyPath, parsed);
      console.log(chalk.green(`✓ Set ${keyPath} = ${value} (global)`));
    } else {
      config.setProject(keyPath, parsed);
      console.log(chalk.green(`✓ Set ${keyPath} = ${value} (project)`));
    }
  } catch (err) {
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }
}

export function configGetCommand(keyPath: string): void {
  const config = new ConfigManager();
  const value = config.get(keyPath);

  if (value === undefined) {
    console.log(chalk.yellow(`Key "${keyPath}" not set.`));
  } else {
    console.log(`${keyPath} = ${JSON.stringify(value)}`);
  }
}

export function configListCommand(): void {
  const config = new ConfigManager();
  const entries = config.listConfig();

  if (entries.length === 0) {
    console.log(chalk.yellow('No configuration set.'));
    return;
  }

  console.log(chalk.bold('\nConfiguration:\n'));

  const maxKeyLen = Math.max(...entries.map(e => e.key.length));

  for (const entry of entries) {
    const source = entry.source === 'global'
      ? chalk.dim('[global]')
      : chalk.cyan('[project]');
    console.log(`  ${entry.key.padEnd(maxKeyLen)}  ${entry.value}  ${source}`);
  }
  console.log('');
}
