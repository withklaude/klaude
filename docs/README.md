# klaude

> Orchestrate Claude Code tasks in Docker containers. Plan by day, run overnight.

<p align="center">
  <img src="https://raw.githubusercontent.com/withklaude/klaude/main/assets/logo.png" alt="klaude" width="128" />
</p>

## What is klaude?

klaude is a CLI that lets you define coding tasks as prompts, then runs them in a Docker container where Claude Code executes them autonomously.

You describe what you want done. klaude generates the tasks, spins up a Docker container, and lets Claude Code do the work. Rate limits, network errors, retries — all handled. You wake up to commits.

## How it works

```
klaude init              # configure the project
klaude plan spec.md      # generate tasks from a spec
klaude run --overnight   # start the container, let Claude work
```

1. **You write** what you want done (a spec, a description, a single task)
2. **klaude generates** the tasks with the right priorities and dependencies
3. **klaude starts** a Docker container with your project mounted
4. **Claude Code does everything** — writes code, commits, tests

klaude doesn't write code. It prepares the environment and lets Claude handle the rest.

## Key Features

- **Overnight mode** — unlimited retries on rate limits and network errors
- **Task state** — tracks pending/completed/failed, resumes where it left off
- **Dependencies** — tasks can depend on other tasks
- **Smart planning** — reads your codebase to generate accurate, detailed tasks
- **Live output** — see what Claude is doing in real-time
- **Git diffs** — saves what Claude changed for each task
- **Webhooks** — get notified when runs complete
- **Auto-update** — CLI updates itself on startup
