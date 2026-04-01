# Planning

`klaude plan` decomposes a spec into sequential tasks using Claude. It reads your codebase first to understand what already exists.

## From a file

```bash
klaude plan spec.md
```

Claude will:
1. Read all source files in your project
2. Analyze the spec
3. Skip features that are already implemented
4. Generate tasks with priorities, dependencies, and detailed prompts
5. Show a preview and ask for confirmation

## Interactive

```bash
klaude plan
```

Choose to enter a file path or describe the work directly.

## Options

```bash
klaude plan spec.md --yes       # skip confirmation
klaude plan spec.md --append    # add to existing tasks (don't overwrite)
klaude plan --from-issues       # generate tasks from GitHub issues
```

## Append mode

Add tasks to an existing plan without overwriting:

```bash
klaude plan new-feature.md --append
```

Claude sees existing tasks and avoids duplicating them.

## From GitHub issues

```bash
klaude plan --from-issues
```

Fetches open issues from the GitHub repo (using `gh` CLI) and generates tasks for each. Tasks include `Closes #N` so they auto-close issues when merged.

## Roadmap integration

If the spec file contains checklist items (`- [ ]` / `- [x]`), each generated task will include an instruction to update the file after completion — marking items as done.

```bash
klaude plan ROADMAP.md
```

## How it works internally

1. Launches Claude Code with `--dangerously-skip-permissions` so it can read your files
2. Claude explores `src/`, `package.json`, config files, etc.
3. Generates a JSON array of tasks with name, priority, depends_on, and prompt
4. klaude writes each task to `.klaude/tasks/`

Output is streamed in real-time so you can see what Claude is reading and thinking.
