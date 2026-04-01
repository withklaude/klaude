import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { input, select, confirm, editor } from '@inquirer/prompts';
import chalk from 'chalk';
import { ConfigManager } from '../core/config-manager.js';
import { TaskLoader } from '../core/task-loader.js';
import { StateManager } from '../core/state-manager.js';

function getTasksDir(): string {
  const config = new ConfigManager();
  const tasksDir = config.getTasksDir();
  if (!tasksDir) {
    console.error(chalk.red('Not inside a klaude project. Run "klaude init" first.'));
    process.exit(1);
  }
  return tasksDir;
}

function getTaskLoader(): TaskLoader {
  return new TaskLoader(getTasksDir());
}

/** Path to the task agent system prompt */
function getAgentPromptPath(): string {
  return path.join(
    path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')),
    '..', 'templates', 'task-agent.md',
  );
}

/** Call Claude Code CLI with the task agent system prompt and full codebase access */
async function askAgent(userMessage: string): Promise<string> {
  const agentPath = getAgentPromptPath();
  const args = ['-p', '--dangerously-skip-permissions', userMessage];

  if (fs.existsSync(agentPath)) {
    args.push('--system-prompt-file', agentPath);
  }

  return new Promise<string>((resolve, reject) => {
    const child = spawn('claude', args, {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      stdout += text;
      process.stderr.write(chalk.dim(text));
    });

    child.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(chalk.dim(chunk.toString('utf-8')));
    });

    child.on('close', (code) => {
      console.log('');
      if (code === 0) resolve(stdout);
      else reject(new Error(`claude exited with code ${code}`));
    });

    child.on('error', reject);
  });
}

/** Show a task preview */
function showPreview(content: string): void {
  console.log(chalk.bold('\n  ── Preview ──────────────────────────'));
  console.log(content.trim().split('\n').map((l: string) => `  ${l}`).join('\n'));
  console.log('');
}

/** Save Claude's output as a task file, return the file path */
function saveTask(tasksDir: string, content: string): string {
  const nameMatch = content.match(/^name:\s*(.+)$/m);
  const taskName = nameMatch ? nameMatch[1].trim() : `task-${Date.now()}`;
  const filePath = path.join(tasksDir, `${taskName}.md`);
  fs.writeFileSync(filePath, content.trim() + '\n', 'utf-8');
  return filePath;
}

// ─── task new ─────────────────────────────────────────────────

export async function taskNewCommand(): Promise<void> {
  const tasksDir = getTasksDir();

  console.log(chalk.bold('\n📝 Create a new task\n'));

  const mode = await select({
    message: 'How do you want to create it?',
    choices: [
      { name: 'With Claude — describe what you need, Claude writes the task', value: 'claude' },
      { name: 'Manual — write it yourself in the editor', value: 'manual' },
    ],
  });

  if (mode === 'manual') {
    await taskNewManual(tasksDir);
    return;
  }

  // Claude-guided creation
  console.log(chalk.dim('\n  Describe what you want Claude to do. Be as specific or vague as you like.\n'));

  const description = await input({ message: 'What should Claude do?' });
  if (!description.trim()) {
    console.error(chalk.red('Description cannot be empty.'));
    process.exit(1);
  }

  // Gather project context for the agent
  const projectRoot = new ConfigManager().getProjectRoot()!;
  let context = '';
  try {
    const files = fs.readdirSync(projectRoot).filter(f => !f.startsWith('.')).slice(0, 30);
    context = `\n\nProject directory contents: ${files.join(', ')}`;
    // Include package.json summary if it exists
    const pkgPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      context += `\npackage.json: name=${pkg.name || '?'}, scripts=${Object.keys(pkg.scripts || {}).join(',')}`;
      if (pkg.dependencies) context += `, deps=${Object.keys(pkg.dependencies).slice(0, 10).join(',')}`;
    }
  } catch { /* ignore */ }

  console.log(chalk.dim('\n  Generating task with Claude...\n'));

  try {
    const result = await askAgent(
      `The user wants to create a task. Here is their description:\n\n${description}${context}\n\n` +
      `Before generating the task, read the project source files to understand the codebase — existing patterns, file structure, conventions. ` +
      `Reference specific files, functions, and patterns in the task prompt so Claude Code knows exactly what to do.\n\n` +
      `Generate the task file. Output ONLY the raw file content (markdown with YAML frontmatter), nothing else.`,
    );

    const filePath = saveTask(tasksDir, result);
    console.log(chalk.green(`✓ Task created: ${path.relative(process.cwd(), filePath)}`));
    showPreview(result);

    await refineLoop(filePath);

  } catch (err) {
    console.error(chalk.red('Failed to generate task.'));
    console.error(chalk.dim((err as Error).message));
    console.log(chalk.yellow('\nMake sure Claude Code CLI is installed and configured.'));
    process.exit(1);
  }
}

/** Manual task creation */
async function taskNewManual(tasksDir: string): Promise<void> {
  const name = await input({
    message: 'Task name (slug):',
    validate: (v) => /^[a-zA-Z0-9_-]+$/.test(v) || 'Use only alphanumeric, hyphens, underscores',
  });

  const prompt = await editor({
    message: 'Write the prompt for Claude (opens editor):',
    default: `# ${name}\n\nDescribe what Claude should accomplish.\n\n## Acceptance criteria\n- [ ] First criterion\n- [ ] Second criterion\n`,
  });

  const content = `---\nname: ${name}\npriority: 1\n---\n\n${prompt.trim()}\n`;
  const filePath = path.join(tasksDir, `${name}.md`);
  fs.writeFileSync(filePath, content, 'utf-8');
  console.log(chalk.green(`\n✓ Task created: ${path.relative(process.cwd(), filePath)}`));
}

// ─── task edit ────────────────────────────────────────────────

export async function taskEditCommand(name?: string): Promise<void> {
  const tasksDir = getTasksDir();
  const loader = new TaskLoader(tasksDir);
  const allTasks = loader.loadAll();

  if (allTasks.length === 0) {
    console.log(chalk.yellow('No tasks found. Create one first with "klaude task new".'));
    return;
  }

  if (!name) {
    name = await select({
      message: 'Which task?',
      choices: allTasks.map(t => ({
        name: `${t.name} ${chalk.dim(t.prompt.split('\n').find(l => l.trim())?.slice(0, 50) || '')}`,
        value: t.name,
      })),
    });
  }

  const task = loader.loadByName(name);
  if (!task) {
    console.error(chalk.red(`Task "${name}" not found.`));
    process.exit(1);
  }

  console.log(chalk.bold(`\n📝 Editing: ${name}\n`));
  showPreview(fs.readFileSync(task.source_path, 'utf-8'));

  const mode = await select({
    message: 'How do you want to edit?',
    choices: [
      { name: 'With Claude — tell Claude what to change', value: 'claude' },
      { name: 'Manual — open in editor', value: 'manual' },
    ],
  });

  if (mode === 'manual') {
    const currentContent = fs.readFileSync(task.source_path, 'utf-8');
    const edited = await editor({ message: 'Edit the task:', default: currentContent });
    fs.writeFileSync(task.source_path, edited, 'utf-8');
    console.log(chalk.green('✓ Task updated.'));
    return;
  }

  await refineLoop(task.source_path);
}

// ─── task generate (alias for new with inline description) ───

export async function taskGenerateCommand(description?: string): Promise<void> {
  if (!description) {
    return taskNewCommand();
  }

  const tasksDir = getTasksDir();

  console.log(chalk.bold('\n🤖 Generating task with Claude...\n'));

  try {
    const result = await askAgent(
      `The user wants to create a task. Here is their description:\n\n${description}\n\n` +
      `Before generating the task, read the project source files to understand the codebase — existing patterns, file structure, conventions. ` +
      `Reference specific files, functions, and patterns in the task prompt so Claude Code knows exactly what to do.\n\n` +
      `Generate the task file. Output ONLY the raw file content (markdown with YAML frontmatter), nothing else.`,
    );

    const filePath = saveTask(tasksDir, result);
    console.log(chalk.green(`✓ Task created: ${path.relative(process.cwd(), filePath)}`));
    showPreview(result);

    await refineLoop(filePath);

  } catch (err) {
    console.error(chalk.red('Failed to generate task.'));
    console.error(chalk.dim((err as Error).message));
    process.exit(1);
  }
}

// ─── Refinement loop ─────────────────────────────────────────

async function refineLoop(filePath: string): Promise<void> {
  while (true) {
    const action = await select({
      message: 'What do you want to do?',
      choices: [
        { name: 'Looks good, save it', value: 'done' },
        { name: 'Tell Claude what to change', value: 'refine' },
      ],
    });

    if (action === 'done') {
      console.log(chalk.green('✓ Task saved.'));
      break;
    }

    const modification = await input({ message: 'What should change?' });
    if (!modification.trim()) continue;

    const currentContent = fs.readFileSync(filePath, 'utf-8');

    console.log(chalk.dim('  Asking Claude...'));

    try {
      const result = await askAgent(
        `Here is the current task file:\n\n${currentContent}\n\n` +
        `The user wants this change: ${modification}\n\n` +
        `Generate ONLY the complete updated file content. Keep the YAML frontmatter format. Apply the requested changes.`,
      );

      fs.writeFileSync(filePath, result.trim() + '\n', 'utf-8');
      console.log(chalk.green('✓ Task updated.'));
      showPreview(result);
    } catch (err) {
      console.error(chalk.red('Claude failed to modify the task.'));
      console.error(chalk.dim((err as Error).message));
    }
  }
}

// ─── task list ────────────────────────────────────────────────

export async function taskListCommand(): Promise<void> {
  const loader = getTaskLoader();
  const tasks = loader.loadAll();

  if (tasks.length === 0) {
    console.log(chalk.yellow('No tasks found.'));
    return;
  }

  const config = new ConfigManager();
  const projectDir = config.getProjectDir();
  const state = projectDir ? new StateManager(projectDir) : null;

  const statusIcon: Record<string, string> = {
    pending: chalk.dim('○'),
    running: chalk.blue('◉'),
    completed: chalk.green('✓'),
    failed: chalk.red('✗'),
    skipped: chalk.yellow('–'),
  };

  console.log(chalk.bold(`\n📋 Tasks (${tasks.length}):\n`));

  for (const task of tasks) {
    const s = state?.get(task.name);
    const icon = statusIcon[s?.status || 'pending'] || '○';
    const prio = task.priority !== undefined ? chalk.dim(`P${task.priority}`) : '';
    const status = s?.status || 'pending';
    const attempts = s && s.attempts > 0 ? chalk.dim(` (${s.attempts}x)`) : '';
    const error = s?.error ? chalk.red(` — ${s.error.slice(0, 60)}`) : '';
    const promptPreview = task.prompt.split('\n').find(l => l.trim())?.slice(0, 50) || '';

    console.log(`  ${icon} ${chalk.cyan(task.name)} ${prio} ${chalk.dim(status)}${attempts}${error}`);
    console.log(`    ${chalk.dim(promptPreview)}`);
  }
  console.log('');
}

// ─── task show ────────────────────────────────────────────────

export async function taskShowCommand(name: string): Promise<void> {
  const loader = getTaskLoader();
  const task = loader.loadByName(name);

  if (!task) {
    console.error(chalk.red(`Task "${name}" not found.`));
    process.exit(1);
  }

  console.log(chalk.bold(`\n📄 Task: ${task.name}\n`));
  console.log(`  Source:    ${task.source_path}`);
  console.log(`  Priority:  ${task.priority ?? 'not set'}`);
  console.log(`  Resources: ${task.resources?.length ? task.resources.join(', ') : 'none'}`);
  console.log(chalk.bold('\n  ── Prompt ──────────────────────────'));
  console.log(task.prompt.split('\n').map(l => `  ${l}`).join('\n'));
  console.log('');
}

// ─── task example ─────────────────────────────────────────────

const EXAMPLE_TASK = `---
name: example-task
priority: 1
---

# Add a health check endpoint

## Objective
Add a GET /health endpoint that returns the application status.

## Context
- The project uses Express.js (see src/app.ts)
- Existing routes are in src/routes/
- Tests use Vitest and live next to source files

## Steps
1. Create src/routes/health.ts with a GET /health handler
2. Return JSON: { "status": "ok", "timestamp": "<ISO date>" }
3. Register the route in src/app.ts
4. Add tests in src/routes/health.test.ts

## Acceptance criteria
- [ ] GET /health returns 200 with { status: "ok", timestamp: "..." }
- [ ] Route is registered in app.ts
- [ ] Tests cover success case
- [ ] npm test passes
- [ ] npm run build passes
`;

export async function taskExampleCommand(): Promise<void> {
  const tasksDir = getTasksDir();
  const filePath = path.join(tasksDir, 'example-task.md');

  fs.writeFileSync(filePath, EXAMPLE_TASK, 'utf-8');
  console.log(chalk.green(`\n✓ Example task created: ${path.relative(process.cwd(), filePath)}`));
  console.log(chalk.dim('  Edit it or use it as a reference for the task format.\n'));
}

// ─── task validate ────────────────────────────────────────────

export async function taskValidateCommand(): Promise<void> {
  const loader = getTaskLoader();
  const tasks = loader.loadAll();

  if (tasks.length === 0) {
    console.log(chalk.yellow('No tasks found.'));
    return;
  }

  let hasErrors = false;
  console.log(chalk.bold('\n🔍 Validating tasks...\n'));

  for (const task of tasks) {
    const errors = loader.validate(task);
    if (errors.length > 0) {
      console.log(`  ${chalk.red('✗')} ${task.name}`);
      for (const err of errors) {
        console.log(`    ${chalk.red('→')} ${err}`);
      }
      hasErrors = true;
    } else {
      console.log(`  ${chalk.green('✓')} ${task.name}`);
    }
  }

  console.log('');
  if (hasErrors) process.exit(1);
}

// ─── task delete ──────────────────────────────────────────────

export async function taskDeleteCommand(name?: string): Promise<void> {
  const loader = getTaskLoader();
  const allTasks = loader.loadAll();

  if (allTasks.length === 0) {
    console.log(chalk.yellow('No tasks to delete.'));
    return;
  }

  if (!name) {
    name = await select({
      message: 'Which task?',
      choices: allTasks.map(t => ({
        name: `${t.name} ${chalk.dim(t.prompt.split('\n').find(l => l.trim())?.slice(0, 50) || '')}`,
        value: t.name,
      })),
    });
  }

  const task = loader.loadByName(name);
  if (!task) {
    console.error(chalk.red(`Task "${name}" not found.`));
    process.exit(1);
  }

  const yes = await confirm({ message: `Delete task "${name}"?`, default: false });
  if (!yes) {
    console.log('Aborted.');
    return;
  }

  const stat = fs.statSync(task.source_path);
  if (stat.isDirectory()) {
    fs.rmSync(task.source_path, { recursive: true, force: true });
  } else {
    fs.unlinkSync(task.source_path);
  }

  console.log(chalk.green(`✓ Task "${name}" deleted.`));

  // Clean up state
  const config = new ConfigManager();
  const projectDir = config.getProjectDir();
  if (projectDir) {
    new StateManager(projectDir).remove(name);
  }
}

// ─── task reset ──────────────────────────────────────────────

export async function taskResetCommand(name?: string, options?: { all?: boolean }): Promise<void> {
  const config = new ConfigManager();
  const projectDir = config.getProjectDir();
  if (!projectDir) {
    console.error(chalk.red('Not inside a klaude project.'));
    process.exit(1);
  }

  const state = new StateManager(projectDir);

  if (options?.all) {
    state.resetAll();
    console.log(chalk.green('✓ All tasks reset to pending.'));
    return;
  }

  const loader = getTaskLoader();
  const allTasks = loader.loadAll();

  if (!name) {
    name = await select({
      message: 'Which task to reset?',
      choices: allTasks.map(t => {
        const s = state.get(t.name);
        return { name: `${t.name} ${chalk.dim(s.status)}`, value: t.name };
      }),
    });
  }

  state.reset(name);
  console.log(chalk.green(`✓ Task "${name}" reset to pending.`));
}

// ─── task skip ───────────────────────────────────────────────

export async function taskSkipCommand(name?: string): Promise<void> {
  const config = new ConfigManager();
  const projectDir = config.getProjectDir();
  if (!projectDir) {
    console.error(chalk.red('Not inside a klaude project.'));
    process.exit(1);
  }

  const state = new StateManager(projectDir);
  const loader = getTaskLoader();
  const allTasks = loader.loadAll();

  if (!name) {
    name = await select({
      message: 'Which task to skip?',
      choices: allTasks.filter(t => state.shouldRun(t.name)).map(t => ({
        name: `${t.name} ${chalk.dim(state.get(t.name).status)}`,
        value: t.name,
      })),
    });
  }

  state.skip(name);
  console.log(chalk.green(`✓ Task "${name}" marked as skipped.`));
}
