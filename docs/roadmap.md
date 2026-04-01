# Roadmap

## Completed

- `klaude init` with guided setup (API key, git, env vars)
- `klaude task` full lifecycle (new, edit, list, show, validate, delete, generate, reset, skip)
- `klaude plan` with codebase analysis, preview, append, from-issues
- `klaude run` with real-time output, overnight mode, watch mode, resume
- Persistent task state (pending/completed/failed/skipped)
- Task dependencies with topological sort and validation
- Task timeout
- Docker image management (registry pull, local build fallback, auto-rebuild)
- Container healthcheck before running tasks
- Git diff capture per task
- Colored output (stderr/stdout)
- Notifications (terminal bell, OS-level)
- Webhooks on run completion
- Graceful shutdown (Ctrl+C stops container)
- `klaude clean` for run history and orphan containers
- `klaude logs` with follow, lines, run selection
- CI/CD with npm publish and Docker image on ghcr.io
- Auto-update CLI on startup
- Concurrent project support

## Planned

- Time estimates based on historical data
- Podman support as Docker alternative
- Test suite
- Plugin system

## Principles

1. **Claude does the work** — klaude orchestrates, it doesn't write code
2. **One command does one thing** — simple and predictable
3. **Runs overnight** — resilient to rate limits, network errors, failures
4. **Guided** — Claude helps at every step, but you can do everything manually
5. **Non-invasive** — everything in `.klaude/`, no changes to your project
