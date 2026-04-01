# Tasks

Tasks are the core unit of work in klaude. Each task is a prompt that Claude Code executes autonomously inside a Docker container.

## Creating tasks

### Claude-guided

```bash
klaude task new
```

Claude reads your project source code, asks what you want, and writes a detailed task prompt with file references, patterns, and acceptance criteria.

### From description

```bash
klaude task generate "add dark mode support"
```

Same as above but skips the interview — Claude generates the task from your one-liner.

### Manual

```bash
klaude task new
# Choose "Manual" → opens your editor
```

### From a spec

```bash
klaude plan spec.md
```

Generates multiple tasks with priorities and dependencies from a spec file. See [Planning](planning.md).

## Task file format

Tasks live in `.klaude/tasks/` as Markdown files with YAML frontmatter:

```markdown
---
name: add-dark-mode
priority: 1
depends_on:
  - setup-theme-system
---

Implement dark mode in the application.

## Context
- React + Tailwind CSS
- Theme system already set up in src/theme/

## Steps
1. Add dark variants to tailwind.config.ts
2. Create ThemeToggle component in src/components/
3. Wire toggle into the header

## Acceptance criteria
- [ ] Dark/light toggle in the header
- [ ] Preference saved in localStorage
- [ ] npm test passes
- [ ] npm run build passes

## Constraints
- Do not modify existing component styles directly
- Use Tailwind dark: prefix
```

### Frontmatter fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Slug identifier (required) |
| `priority` | number | Execution order — lower runs first |
| `depends_on` | string[] | Task names that must complete before this one |
| `settings.timeout` | number | Max minutes for this task |

Everything after the frontmatter is the **prompt** Claude Code receives.

## Managing tasks

```bash
klaude task list               # list all tasks with status
klaude task show <name>        # full task details
klaude task edit [name]        # edit with Claude or editor
klaude task validate           # check all tasks for errors
klaude task delete [name]      # delete a task
klaude task example            # create an example task
```

## Tips for good tasks

- **Be specific about files** — name exact paths, not "the API"
- **Reference existing patterns** — "follow the same structure as `src/routes/products.ts`"
- **Include verification** — "run `npm test` and fix failures"
- **Set constraints** — "do not install new dependencies"
- **One logical change per task** — easier for Claude to get right
