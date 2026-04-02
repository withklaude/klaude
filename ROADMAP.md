# Roadmap

## v0.1 — Foundation

- [x] `klaude init` with guided setup (API key, git, env vars, Claude Code agent)
- [x] `klaude task new` with Claude-guided or manual creation
- [x] `klaude task edit` with Claude-guided or editor modification
- [x] `klaude plan` generates tasks from a spec file
- [x] `klaude run` with real-time output
- [x] Overnight mode with unlimited retries
- [x] One container per run, git configured inside
- [x] Report and logs for every run
- [x] Claude Code agent installed in the project
- [x] Generic env vars injected into the container
- [x] Persistent task state (pending/completed/failed/skipped)
- [x] `task reset` and `task skip` commands
- [x] Docker image pulled from registry, auto-rebuild after 24h
- [x] Concurrent project support with build locking
- [x] CI/CD: npm publish + Docker image on ghcr.io
- [x] Auto-update CLI on startup when new version available
- [x] Plan appends roadmap update instruction to tasks when spec has checklists

## v0.2 — Usability (current)

- [x] `klaude plan` shows preview and asks confirmation before creating
- [x] `klaude run --watch` restarts automatically if tasks change
- [x] `klaude clean` removes old runs and orphan containers
- [x] `klaude logs <task>` shows logs from the last run
- [x] Notification on run completion (terminal bell, desktop notification)
- [x] Colored output to distinguish stderr/stdout from Claude
- [x] `klaude plan` reads project code to avoid duplicating existing features
- [x] Graceful shutdown: Ctrl+C stops the container
- [x] Fix false positive rate limit detection
- [x] Full resume: pick up from the exact task where it stopped
- [x] Task timeout (prevent infinite runs)
- [x] Save git diff per task (what Claude changed)
- [x] Healthcheck: verify container is responsive before running tasks
- [x] Explicit task dependencies (task B waits for task A)
- [x] `klaude plan --from-issues` generates tasks from GitHub issues
- [x] `klaude plan --append` adds tasks to an existing plan
- [x] Webhooks on run completion (Slack, Discord, email)
- [x] `klaude task suggest` — analyze codebase and suggest next tasks
- [x] Published on npm

## v0.3 — Developer Experience

- [ ] `--debug` flag for verbose logging across all commands
- [ ] `klaude run --parallel <n>` — run independent tasks in parallel
- [ ] `klaude diff <task>` — shortcut to view changes from a task
- [ ] Task duration metrics (saved in state.yaml as `duration_seconds`)
- [ ] Time estimates based on historical run data

## v0.4 — Multi-runtime

- [ ] Container runtime abstraction layer
- [ ] Podman support as Docker alternative

## v1.0 — Production Ready

- [ ] Test suite (unit + integration)
- [ ] Full documentation
- [ ] Plugin system

## Principles

1. **Claude does the work** — klaude orchestrates, it doesn't write code
2. **One command does one thing** — simple and predictable
3. **Runs overnight** — resilient to rate limits, network errors, failures
4. **Guided** — Claude helps at every step, but you can do everything manually
5. **Non-invasive** — everything in `.klaude/`, no changes to your project
