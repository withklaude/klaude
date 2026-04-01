# klaude

> Orchestrate Claude Code tasks in Docker containers. Plan by day, run overnight.

<p align="center">
  <img src="https://raw.githubusercontent.com/withklaude/klaude/main/assets/logo.png" alt="klaude" width="128" />
</p>

<div class="install-banner">
  <div class="install-row">
    <code>npm install -g klaude-tool</code>
    <button class="copy-btn" onclick="navigator.clipboard.writeText('npm install -g klaude-tool').then(()=>{this.textContent='Copied!';this.classList.add('copied');setTimeout(()=>{this.textContent='Copy';this.classList.remove('copied')},2000)})">Copy</button>
  </div>
  <div class="links">
    <a href="https://www.npmjs.com/package/klaude-tool">npm</a>
    <a href="https://github.com/withklaude/klaude">GitHub</a>
    <a href="https://github.com/withklaude/klaude/pkgs/container/klaude">Docker</a>
    <a href="#/quickstart">Quick Start</a>
  </div>
</div>

## What is klaude?

klaude is a CLI that lets you define coding tasks as prompts, then runs them in a Docker container where Claude Code executes them autonomously.

You describe what you want done. klaude generates the tasks, spins up a Docker container, and lets Claude Code do the work. Rate limits, network errors, retries — all handled. You wake up to commits.

## How it works

```bash
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

| Feature | Description |
|---------|-------------|
| **Overnight mode** | Unlimited retries on rate limits and network errors |
| **Task state** | Tracks pending/completed/failed, resumes where it left off |
| **Dependencies** | Tasks can declare `depends_on` for execution ordering |
| **Smart planning** | Reads your codebase to generate accurate tasks |
| **Live output** | See what Claude is doing in real-time |
| **Git diffs** | Saves what Claude changed for each task |
| **Webhooks** | Get notified on Slack/Discord when runs complete |
| **Healthcheck** | Verifies container is ready before running |
| **Auto-update** | CLI updates itself on startup |

## Safe by design

Claude Code runs inside an **isolated Docker container** — not on your machine. It only has access to what you explicitly give it:

- **Your project** is mounted at `/workspace` — nothing else from your filesystem
- **Credentials** are injected as env vars — only the ones you configure
- **Git** uses a dedicated identity — not your personal credentials
- **Network** is available but the container can't access your local services
- No access to your SSH keys, browser sessions, cloud configs, or other projects

If Claude makes a mistake, it's contained. Your machine is untouched.

## Get started

1. [Install klaude](installation.md)
2. [Quick Start guide](quickstart.md)
3. [Learn about tasks](tasks.md)
4. [Full command reference](commands.md)
