import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
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

export async function planCommand(specFile?: string, options: { yes?: boolean; append?: boolean; fromIssues?: boolean } = {}): Promise<void> {
  const config = new ConfigManager();
  const tasksDir = config.getTasksDir();
  if (!tasksDir) {
    console.error(chalk.red('Not inside a klaude project. Run "klaude init" first.'));
    process.exit(1);
  }

  // Read the spec
  let specContent: string;

  if (options.fromIssues) {
    // Detect GitHub repo from git remote
    const projectRoot = config.getProjectRoot()!;
    let repoSlug: string;
    try {
      const remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
        encoding: 'utf-8',
        cwd: projectRoot,
      }).trim();
      // Parse: https://github.com/owner/repo.git or git@github.com:owner/repo.git
      const match = remote.match(/github\.com[:\/]([^\/]+\/[^\.]+)/);
      if (!match) throw new Error('Not a GitHub repository');
      repoSlug = match[1];
    } catch (err) {
      console.error(chalk.red('Could not detect GitHub repository from git remote.'));
      process.exit(1);
    }

    // Fetch open issues using gh CLI
    console.log(chalk.dim(`  Fetching issues from ${repoSlug!}...\n`));
    try {
      const issuesJson = execFileSync('gh', [
        'issue', 'list', '--repo', repoSlug!,
        '--state', 'open', '--json', 'number,title,body,labels',
        '--limit', '20',
      ], { encoding: 'utf-8', timeout: 30000 });

      const issues = JSON.parse(issuesJson);
      if (issues.length === 0) {
        console.log(chalk.yellow('No open issues found.'));
        return;
      }

      // Format issues as spec content
      specContent = issues.map((i: any) =>
        `## Issue #${i.number}: ${i.title}\n${i.body || 'No description'}\nLabels: ${i.labels?.map((l: any) => l.name).join(', ') || 'none'}`
      ).join('\n\n');

      console.log(chalk.bold(`  📋 Found ${issues.length} open issue(s)\n`));
    } catch (err) {
      console.error(chalk.red('Failed to fetch issues. Is `gh` CLI installed and authenticated?'));
      console.error(chalk.dim((err as Error).message));
      process.exit(1);
    }
  } else if (specFile) {
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
      if (options.append) {
        // Include existing task summaries so the agent knows what's already planned
        existingTasks += '\n\nExisting task summaries (DO NOT duplicate these):';
        for (const file of existing) {
          const content = fs.readFileSync(path.join(tasksDir, file), 'utf-8');
          const firstLines = content.split('\n').slice(0, 5).join('\n');
          existingTasks += `\n- ${file}: ${firstLines}`;
        }
      }
    }
  } catch { /* ignore */ }

  console.log(chalk.dim('  Analyzing codebase and generating tasks...\n'));

  // Call the plan agent with full permissions so it can read the codebase
  const agentPath = getTemplatePath('plan-agent.md');
  const args = ['-p', '--dangerously-skip-permissions',
    `Project root: ${projectRoot}\n\n` +
    `Here is the specification/description of work to be done:\n\n` +
    `---\n${specContent}\n---\n\n` +
    `Project context:${context}${existingTasks}\n\n` +
    `IMPORTANT: Before generating tasks, thoroughly read ALL source files in the project. ` +
    `Explore every file in src/, read the full content of each one, check package.json, config files, and templates. ` +
    `You must understand what already exists before deciding what tasks to generate.\n\n` +
    `Then:\n` +
    `1. Do NOT generate tasks for features already implemented.\n` +
    `2. For each task, reference specific files, functions, types, and patterns you found in the code.\n` +
    `3. Each task prompt must include exact file paths, existing code patterns to follow, and detailed implementation steps.\n` +
    `4. Be exhaustive — each task should have enough context that Claude Code can implement it independently.\n\n` +
    (options.append ? `Only generate NEW tasks that don't overlap with existing ones. This is an append operation.\n\n` : '') +
    (options.fromIssues ? `Each task should reference the GitHub issue number it addresses. Include 'Closes #N' in the task prompt so Claude Code will reference the issue.\n\n` : '') +
    `Output ONLY a JSON array as specified.`,
  ];

  let rawOutput: string;
  try {
    rawOutput = await new Promise<string>((resolve, reject) => {
      const child = spawn('claude', args, {
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        stdout += text;
        // Stream output so user sees progress
        process.stderr.write(chalk.dim(text));
      });

      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        stderr += text;
        process.stderr.write(chalk.dim(text));
      });

      child.on('close', (code) => {
        console.log(''); // newline after streaming
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `claude exited with code ${code}`));
        }
      });

      child.on('error', reject);
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
    const filePath = path.join(tasksDir, `${task.name}.md`);
    if (fs.existsSync(filePath) && options.append) {
      console.log(`  ${chalk.yellow('⚠')} ${task.name} — skipped (already exists)`);
      continue;
    }
    const content = `---\nname: ${task.name}\npriority: ${task.priority}\n---\n\n${task.prompt.trim()}\n`;
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
