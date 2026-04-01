# CLI Commands

## `klaude init`

Initialize `.klaude/` in the current project.

```bash
klaude init
```

## `klaude plan`

Generate tasks from a spec file or description.

```bash
klaude plan <spec-file>        # from file
klaude plan                    # interactive
klaude plan spec.md --yes      # skip confirmation
klaude plan spec.md --append   # add to existing tasks
klaude plan --from-issues      # from GitHub issues
```

## `klaude task`

```bash
klaude task new                # create (Claude-guided or manual)
klaude task list               # list all tasks with status
klaude task show <name>        # show full details
klaude task edit [name]        # edit (with Claude or editor)
klaude task validate           # validate all tasks
klaude task delete [name]      # delete a task
klaude task generate "<desc>"  # generate from description
klaude task example            # create an example task
klaude task reset [name]       # reset to pending
klaude task reset --all        # reset all tasks
klaude task skip [name]        # mark as skipped
```

## `klaude run`

```bash
klaude run <task>              # run one task
klaude run --all               # run all tasks
klaude run --overnight         # unlimited retries
klaude run --dry-run           # preview
klaude run --resume            # resume interrupted run
klaude run --watch             # restart on task file changes
```

## `klaude status`

```bash
klaude status                  # latest run summary
klaude status --follow         # stream live logs
```

## `klaude logs`

```bash
klaude logs <task>             # logs from last run
klaude logs <task> --follow    # tail in real-time
klaude logs <task> --lines 50  # last 50 lines
klaude logs <task> --run <id>  # from a specific run
```

## `klaude stop`

```bash
klaude stop                    # stop running container
klaude stop --all              # stop all klaude containers
```

## `klaude clean`

```bash
klaude clean                   # remove old runs (keep last 5) + orphan containers
klaude clean --all             # remove all runs
klaude clean --keep 10         # keep last 10
klaude clean --runs-only       # only clean runs
klaude clean --containers-only # only clean containers
klaude clean --yes             # skip confirmation
```

## `klaude config`

```bash
klaude config set <key> <value>           # project config
klaude config set <key> <value> --global  # global config
klaude config get <key>
klaude config list
```
