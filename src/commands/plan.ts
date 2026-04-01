import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { confirm, input, select } from '@inquirer/prompts';
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

export async function planCommand(specFile?: string, options: { yes?: boolean } = {}): Promise<void> {
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

  // Read source code structure for context
  let codeContext = '';
  try {
    const srcDir = path.join(projectRoot, 'src');
    if (fs.existsSync(srcDir)) {
      const collectFiles = (dir: string, prefix = ''): string[] => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const result: string[] = [];
        for (const entry of entries) {
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            result.push(...collectFiles(path.join(dir, entry.name), rel));
          } else {
            result.push(rel);
          }
        }
        return result;
      };
      const srcFiles = collectFiles(srcDir);
      codeContext = `\n\nSource files in src/:\n${srcFiles.join('\n')}`;

      // Include key file contents (index, types, commands) — truncated
      const keyFiles = srcFiles.filter(f =>
        f.endsWith('index.ts') || f.includes('types/') || f.startsWith('commands/')
      ).slice(0, 10);
      for (const f of keyFiles) {
        const fullPath = path.join(srcDir, f);
        const content = fs.readFileSync(fullPath, 'utf-8');
        const truncated = content.slice(0, 2000);
        codeContext += `\n\n--- src/${f} ---\n${truncated}${content.length > 2000 ? '\n... (truncated)' : ''}`;
      }
    }
  } catch { /* ignore */ }

  console.log(chalk.dim('  Analyzing spec and generating tasks...\n'));

  // Call the plan agent
  const agentPath = getTemplatePath('plan-agent.md');
  const args = ['-p',
    `Here is the specification/description of work to be done:\n\n` +
    `---\n${specContent}\n---\n\n` +
    `Project context:${context}${existingTasks}${codeContext}\n\n` +
    `IMPORTANT: Read the existing code carefully. Do NOT generate tasks for features that are already implemented. Only generate tasks for what is genuinely missing.\n\n` +
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

  // If the spec is a roadmap, tell each task to update it
  const hasRoadmapItems = specContent.includes('- [ ]') || specContent.includes('- [x]');
  const roadmapFile = specFile && hasRoadmapItems ? specFile : null;
  if (roadmapFile) {
    for (const task of tasks) {
      task.prompt += `\n\nAfter completing this task, update ${roadmapFile}: mark the corresponding item as done (change \`- [ ]\` to \`- [x]\`). Only mark items that are fully implemented.`;
    }
  }

  // Preview tasks
  console.log(chalk.bold(`  📋 Planned ${tasks.length} task${tasks.length === 1 ? '' : 's'}:\n`));
  for (const task of tasks) {
    const firstLine = task.prompt.split('\n').find(l => l.trim()) || task.name;
    console.log(`  ${chalk.cyan(`P${task.priority}`)} ${chalk.bold(task.name)}`);
    console.log(`     ${chalk.dim(firstLine.replace(/^#+\s*/, '').slice(0, 70))}`);
  }
  console.log('');

  // Confirm before writing
  if (!options.yes) {
    const proceed = await confirm({
      message: `Create these ${tasks.length} task${tasks.length === 1 ? '' : 's'}?`,
      default: true,
    });
    if (!proceed) {
      console.log(chalk.yellow('  Plan discarded. No tasks were created.'));
      return;
    }
  }

  // Write task files
  console.log('');
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
