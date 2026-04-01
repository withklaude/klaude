# Task State

Every task has a persistent status tracked in `.klaude/state.yaml`.

## Lifecycle

```
pending  →  running  →  completed
                     →  failed
```

A task can also be manually set to `skipped`.

## How `klaude run` uses state

| Status | Behavior |
|--------|----------|
| `pending` | Runs the task |
| `failed` | Retries the task |
| `running` (interrupted) | Retries the task |
| `completed` | Skips the task |
| `skipped` | Skips the task |

## Viewing state

```bash
klaude task list
```

```
  ✓ setup-database     P1  completed
  ✓ implement-api      P2  completed
  ✗ add-tests          P3  failed (2x) — npm test exit code 1
  ○ update-docs        P4  pending
  – deploy-config      P5  skipped
```

Icons:
- ○ pending
- ◉ running
- ✓ completed
- ✗ failed (shows attempt count and error)
- – skipped

## Managing state

### Reset a task

```bash
klaude task reset add-tests        # re-run a specific task
klaude task reset --all            # re-run everything
```

### Skip a task

```bash
klaude task skip deploy-config     # exclude from next run
```

### Delete a task

```bash
klaude task delete old-task        # removes file and state
```

## Automatic behavior

- **Failed tasks retry automatically** on the next `klaude run`
- **Completed tasks are skipped** — use `reset` to force re-run
- **Interrupted tasks** (stuck in "running") are recovered on `--resume`
- **Dependencies** — if a dependency fails, dependent tasks are skipped with an error
