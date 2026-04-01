# Running Tasks

## Basic usage

```bash
klaude run <task-name>         # run one task
klaude run --all               # run all pending/failed tasks
klaude run --overnight         # unlimited retries, run all night
klaude run --dry-run           # preview without executing
klaude run --resume            # resume an interrupted run
klaude run --watch             # restart when task files change
```

## What happens during a run

1. Docker image is pulled from registry (or built locally if unavailable)
2. Container starts with your project mounted at `/workspace`
3. Git, credentials, and env vars are configured inside
4. Healthcheck verifies the container is ready
5. Tasks execute sequentially in dependency/priority order
6. Each task: write prompt → Claude Code runs → save log + git diff
7. State is updated after each task (completed/failed)
8. Report generated in `.klaude/runs/`

## Overnight mode

```bash
klaude run --overnight
```

Designed to run unattended:
- Unlimited retries on rate limits
- Handles "hit your limit" messages — waits until reset time
- Waits for network connectivity if connection drops
- All tasks run sequentially, changes accumulate

## Watch mode

```bash
klaude run --all --watch
```

Monitors `.klaude/tasks/` for changes. When you edit a task file, the current run stops and restarts with the updated tasks.

## Resume

```bash
klaude run --resume
```

If a run was interrupted (Ctrl+C, crash, reboot):
- Tasks stuck in "running" are reset to pending
- Completed tasks are skipped
- Failed tasks are retried

## Task timeout

Set a timeout per task to prevent infinite runs:

```markdown
---
name: my-task
settings:
  timeout: 30  # minutes
---
```

When a task times out, Claude is killed and the task is marked as failed.

## Output

Claude's output streams to your terminal in real-time:
- **Dimmed text** — stdout (Claude's normal output)
- **Red text** — stderr
- **Yellow** — rate limit warnings
- **Icons** — ✓ completed, ✗ failed

## Logs and reports

After a run:
```bash
klaude status                  # summary
klaude logs <task>             # full output
klaude logs <task> --follow    # tail in real-time
```

Reports are saved in `.klaude/runs/<run-id>/`:
- `report.md` — human-readable summary
- `state.json` — machine-readable state
- `<task>.log` — full Claude output per task
- `<task>.diff` — git diff of changes per task
