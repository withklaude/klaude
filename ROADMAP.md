# Roadmap

## v0.1 — Current

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

## v0.2 — Usability

- [ ] `klaude plan` shows preview and asks confirmation before creating
- [ ] `klaude run --watch` restarts automatically if tasks change
- [ ] `klaude clean` removes old runs and orphan containers
- [ ] `klaude logs <task>` shows logs from the last run
- [ ] Notification on run completion (terminal bell, desktop notification)
- [ ] Colored output to distinguish stderr/stdout from Claude

## v0.3 — Reliability

- [ ] Full resume: pick up from the exact task where it stopped
- [ ] Task timeout (prevent infinite runs)
- [ ] Save git diff per task (what Claude changed)
- [ ] Healthcheck: verify container is responsive before running tasks

## v0.4 — Smart planning

- [ ] `klaude plan` reads project code for better context
- [ ] Explicit task dependencies (task B waits for task A)
- [ ] `klaude plan --from-issues` generates tasks from GitHub issues
- [ ] `klaude plan --append` adds tasks to an existing plan
- [ ] Time estimates based on historical data

## v0.5 — Integration

- [ ] Webhooks on run completion (Slack, Discord, email)
- [ ] Podman support as Docker alternative

## v1.0

- [ ] Test suite
- [ ] Full documentation
- [ ] Plugin system
- [ ] Published on npm

## Principles

1. **Claude does the work** — klaude orchestrates, it doesn't write code
2. **One command does one thing** — simple and predictable
3. **Runs overnight** — resilient to rate limits, network errors, failures
4. **Guided** — Claude helps at every step, but you can do everything manually
5. **Non-invasive** — everything in `.klaude/`, no changes to your project
