<p align="center">
  <img src="assets/logo.png" alt="klaude" width="128" />
</p>

<h1 align="center">klaude</h1>

<p align="center">
  Orchestrate Claude Code tasks in Docker containers.<br>
  Plan by day, run overnight.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/klaude-tool"><img src="https://img.shields.io/npm/v/klaude-tool?color=cb3837&label=npm" alt="npm version" /></a>
  <a href="https://github.com/withklaude/klaude/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/withklaude/klaude/ci.yml?label=CI" alt="CI" /></a>
  <a href="https://github.com/withklaude/klaude/pkgs/container/klaude"><img src="https://img.shields.io/badge/ghcr.io-klaude-blue?logo=docker" alt="Docker" /></a>
  <a href="https://github.com/withklaude/klaude/blob/main/LICENSE"><img src="https://img.shields.io/github/license/withklaude/klaude" alt="License" /></a>
  <a href="https://github.com/withklaude/klaude"><img src="https://img.shields.io/github/stars/withklaude/klaude?style=flat" alt="GitHub stars" /></a>
</p>

<p align="center">
  <a href="https://withklaude.github.io/klaude/">Documentation</a> &middot;
  <a href="#installation">Installation</a> &middot;
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#commands">Commands</a> &middot;
  <a href="#how-it-works">How It Works</a> &middot;
  <a href="ROADMAP.md">Roadmap</a>
</p>

---

## What is klaude

You describe what you want done. klaude generates the tasks, spins up a Docker container, and lets Claude Code do the work autonomously. Rate limits, network errors, retries — all handled. You wake up to commits.

```
klaude init              # configure the project
klaude plan spec.md      # generate tasks from a spec
klaude run --overnight   # start the container, let Claude work
```

## Installation

**Prerequisites:** Node.js >= 18, Docker Desktop running.

```bash
npm install -g klaude-tool
```

## Quick Start

```bash
cd your-project
klaude init                           # setup (API key, git, env vars)
klaude plan spec.md                   # generate tasks from a spec
klaude run --overnight                # run all tasks with unlimited retries
```

Or one task at a time:

```bash
klaude task generate "add dark mode"  # Claude writes the task prompt
klaude run add-dark-mode              # run just that task
```

Check results in the morning:

```bash
klaude task list                      # see what passed/failed
git log --oneline -20                 # see what Claude committed
```

## Commands

### `klaude init`

Initialize `.klaude/` in the current project. Configures API key, git identity, environment variables, and installs the Claude Code agent.

### `klaude plan [file]`

Decompose a spec file into ordered tasks. Claude analyzes the work, splits it into independent tasks with priorities, and creates them ready to run.

```bash
klaude plan spec.md                   # from file
klaude plan                           # interactive
klaude plan spec.md --yes             # skip confirmation
```

Claude reads the existing source code to avoid generating tasks for features that are already implemented. If the spec contains checklist items (`- [ ]`), each task prompt includes an instruction to update the file after completion.

### `klaude task`

| Command | Description |
|---------|-------------|
| `task new` | Create a task (Claude-guided or manual) |
| `task edit [name]` | Edit a task (with Claude or editor) |
| `task list` | List all tasks with status |
| `task show <name>` | Show full task details |
| `task validate` | Validate all tasks |
| `task delete [name]` | Delete a task |
| `task generate "<desc>"` | Generate task from description |
| `task example` | Create an example task |
| `task reset [name]` | Reset task to pending |
| `task reset --all` | Reset all tasks |
| `task skip [name]` | Mark task as skipped |

### `klaude run`

```bash
klaude run <task>         # run a specific task
klaude run --all          # run all tasks in priority order
klaude run --overnight    # all tasks, unlimited retries on rate limits
klaude run --dry-run      # preview without executing
klaude run --resume       # resume an interrupted run
```

Only pending and failed tasks run. Completed tasks are skipped automatically. Use `task reset` to re-run a completed task.

### `klaude status` / `klaude stop`

```bash
klaude status             # running containers and latest report
klaude status --follow    # stream live logs
klaude stop               # stop running container
klaude stop --all         # stop all klaude containers
```

### `klaude logs`

```bash
klaude logs <task>            # show logs from the last run
klaude logs <task> --follow   # tail logs in real-time
klaude logs <task> --lines 50 # show last 50 lines
klaude logs <task> --run <id> # logs from a specific run
```

### `klaude clean`

```bash
klaude clean                  # remove old runs (keeps last 5) and orphan containers
klaude clean --all            # remove all runs
klaude clean --keep 10        # keep last 10 runs
klaude clean --runs-only      # only clean run directories
klaude clean --containers-only # only clean orphan containers
```

### `klaude config`

```bash
klaude config set <key> <value>           # project config
klaude config set <key> <value> --global  # global config
klaude config get <key>
klaude config list
```

## Task format

Tasks are Markdown files with YAML frontmatter in `.klaude/tasks/`:

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
- Colors are hardcoded in components

## Acceptance criteria
- [ ] Dark/light toggle in the header
- [ ] Preference saved in localStorage
- [ ] npm test passes
- [ ] npm run build passes
```

Everything after the frontmatter is the **prompt** Claude Code receives.

## Task state

Every task has a persistent status:

```
pending  →  running  →  completed
                     →  failed
```

`klaude run` skips completed and skipped tasks, retries failed ones. Use `task reset` to re-run something, `task skip` to exclude it.

`klaude task list` shows the status at a glance:

```
  ✓ setup-database     P1  completed
  ✓ implement-api      P2  completed
  ✗ add-tests          P3  failed (2x) — npm test exit code 1
  ○ update-docs        P4  pending
```

## How it works

1. klaude starts **one Docker container** per run
2. Configures git, env vars, and Claude Code inside the container
3. For each task (in priority order):
   - Writes the prompt into the container
   - Runs `claude --print --dangerously-skip-permissions`
   - Streams output to your terminal in real-time
   - The wrapper handles rate limits and network errors automatically
4. Updates task state (completed/failed)
5. Generates a report in `.klaude/runs/`
6. Stops and removes the container

### Docker image

The image (`klaude-ubuntu`) is pulled from the registry on first run. It includes Ubuntu 24.04, Node.js 22, and Claude Code CLI. The image is automatically refreshed every 24 hours to keep Claude Code up to date.

If the pull fails (offline, private network), klaude builds the image locally as a fallback.

### Resilience

- **Rate limits** — exponential backoff (1m, 2m, 5m, 10m, 15m cap), automatic retries
- **Network errors** — waits for connectivity, then resumes
- **Overnight mode** — unlimited retries, designed to run unattended
- **Concurrent projects** — run klaude in multiple directories simultaneously
- **Report** — always generated, even on failure

## Safe by design

Claude Code runs inside an **isolated Docker container**, not on your machine. It only has access to what you explicitly provide:

- Your project mounted at `/workspace` — nothing else from your filesystem
- Only the credentials you configure (env vars, git token)
- A dedicated git identity — not your personal credentials
- No access to SSH keys, browser sessions, cloud configs, or other projects

## Configuration

### Global (`~/.klaude/config.yaml`)

```yaml
anthropic:
  api_key: sk-ant-...
git:
  user: your-name
  email: you@email.com
  token: ghp_...
env:
  NPM_TOKEN: "..."
  SONAR_TOKEN: "..."
docker:
  image: klaude-ubuntu
  registry_image: ghcr.io/withklaude/klaude
  memory: 4g
  cpus: 2
  rebuild_after_hours: 24
```

### Project (`.klaude/config.yaml`)

```yaml
tasks_dir: tasks
docker:
  memory: 8g
mounts:
  - ~/shared-libs
```

Project values override global values.

## Project structure

```
.klaude/
  config.yaml             # project configuration
  state.yaml              # persistent task state
  tasks/                  # task files (prompts for Claude)
    setup-database.md
    implement-api.md
    add-tests.md
  runs/                   # run history
    2026-04-01T.../
      report.md           # run report
      state.json          # run state (for resume)
      setup-database.log  # full Claude output
```

## Claude Code agent

`klaude init` installs an agent at `.claude/agents/klaude.md`. Inside Claude Code, use `/klaude` to manage everything without memorizing commands.

## Development

```bash
git clone https://github.com/withklaude/klaude.git
cd klaude
npm install
npm run build
npm link              # makes 'klaude' available globally
```

## License

[MIT](LICENSE)
