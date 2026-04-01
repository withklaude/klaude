import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { input, select } from '@inquirer/prompts';
import chalk from 'chalk';
import { ConfigManager } from '../core/config-manager.js';

function getTemplatePath(filename: string): string {
  return path.join(
    path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')),
    '..', 'templates', filename,
  );
}

interface PlannedTask {
  name: string;
  priority: number;
  prompt: string;
}

export async function planCommand(specFile?: string): Promise<void> {
  const config = new ConfigManager();
  const tasksDir = config.getTasksDir();
  if (!tasksDir) {
    console.error(chalk.red('Not inside a klaude project. Run "klaude init" first.'));
    process.exit(1);
  }

  // Read the spec
  let specContent: string;

  if (specFile) {
    const specPath = path.isAbsolute(specFile) ? specFile : path.resolve(specFile);
    if (!fs.existsSync(specPath)) {
      console.error(chalk.red(`File not found: ${specFile}`));
      process.exit(1);
    }
    specContent = fs.readFileSync(specPath, 'utf-8');
    console.log(chalk.bold(`\n📋 Planning from: ${specFile}\n`));
  } else {
    const mode = await select({
      message: 'How do you want to provide the spec?',
      choices: [
        { name: 'Enter a file path', value: 'file' },
        { name: 'Describe it now', value: 'describe' },
      ],
    });

    if (mode === 'file') {
      const filePath = await input({ message: 'Path to spec file:' });
      const resolved = path.resolve(filePath.trim());
      if (!fs.existsSync(resolved)) {
        console.error(chalk.red(`File not found: ${filePath}`));
        process.exit(1);
      }
      specContent = fs.readFileSync(resolved, 'utf-8');
    } else {
      specContent = await input({ message: 'Describe the work to be done:' });
      if (!specContent.trim()) {
        console.error(chalk.red('Description cannot be empty.'));
        process.exit(1);
      }
    }
    console.log('');
  }

  // Gather project context
  const projectRoot = config.getProjectRoot()!;
  let context = '';
  try {
    const files = fs.readdirSync(projectRoot).filter(f => !f.startsWith('.')).slice(0, 30);
    context = `\nProject files: ${files.join(', ')}`;
    const pkgPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      context += `\npackage.json: name=${pkg.name || '?'}`;
      if (pkg.scripts) context += `, scripts=${Object.keys(pkg.scripts).join(',')}`;
      if (pkg.dependencies) context += `, deps=${Object.keys(pkg.dependencies).slice(0, 15).join(',')}`;
    }
  } catch { /* ignore */ }

  let existingTasks = '';
  try {
    const existing = fs.readdirSync(tasksDir).filter(f => !f.startsWith('.'));
    if (existing.length > 0) {
      existingTasks = `\nExisting tasks (avoid name conflicts): ${existing.join(', ')}`;
    }
  } catch { /* ignore */ }

  console.log(chalk.dim('  Analyzing spec and generating tasks...\n'));

  // Call the plan agent
  const agentPath = getTemplatePath('plan-agent.md');
  const args = ['-p',
    `Here is the specification/description of work to be done:\n\n` +
    `---\n${specContent}\n---\n\n` +
    `Project context:${context}${existingTasks}\n\n` +
    `Decompose this into sequential tasks. Output ONLY a JSON array as specified.`,
  ];

  if (fs.existsSync(agentPath)) {
    args.push('--system-prompt-file', agentPath);
  }

  let rawOutput: string;
  try {
    rawOutput = execFileSync('claude', args, {
      encoding: 'utf-8',
      timeout: 300_000,
      env: { ...process.env },
    });
  } catch (err) {
    console.error(chalk.red('Failed to generate plan.'));
    console.error(chalk.dim((err as Error).message));
    process.exit(1);
  }

  // Parse JSON
  let tasks: PlannedTask[];
  try {
    const jsonMatch = rawOutput.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array found in output');
    tasks = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(tasks) || tasks.length === 0) throw new Error('Empty task array');
  } catch (err) {
    console.error(chalk.red('Failed to parse plan output.'));
    console.error(chalk.dim((err as Error).message));
    console.error(chalk.dim(rawOutput.slice(0, 500)));
    process.exit(1);
  }

  tasks.sort((a, b) => a.priority - b.priority);

  // Show plan and create tasks
  console.log(chalk.bold(`  📋 ${tasks.length} tasks created:\n`));

  for (const task of tasks) {
    const content = `---\nname: ${task.name}\npriority: ${task.priority}\n---\n\n${task.prompt.trim()}\n`;
    const filePath = path.join(tasksDir, `${task.name}.md`);
    fs.writeFileSync(filePath, content, 'utf-8');

    const firstLine = task.prompt.split('\n').find(l => l.trim()) || task.name;
    console.log(`  ${chalk.green('✓')} ${chalk.cyan(`P${task.priority}`)} ${chalk.bold(task.name)}`);
    console.log(`     ${chalk.dim(firstLine.replace(/^#+\s*/, '').slice(0, 70))}`);
  }

  console.log('');
  console.log(`  Run them: ${chalk.cyan('klaude run --all')}`);
  console.log(`  Preview:  ${chalk.cyan('klaude run --dry-run')}`);
  console.log('');
}
