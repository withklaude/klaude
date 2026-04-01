# klaude

> Orchestrate Claude Code tasks in Docker containers. Plan by day, run overnight.

<p align="center">
  <img src="https://raw.githubusercontent.com/withklaude/klaude/main/assets/logo.png" alt="klaude" width="128" />
</p>

<div class="install-banner">
  <div class="install-row">
    <code class="install-cmd" title="Click to copy">npm install -g klaude-tool</code>
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

<ol class="steps">
  <li><strong>You write</strong> what you want done — a spec, a description, a single task</li>
  <li><strong>klaude generates</strong> the tasks with priorities and dependencies</li>
  <li><strong>klaude starts</strong> a Docker container with your project mounted</li>
  <li><strong>Claude Code does everything</strong> — writes code, commits, tests</li>
</ol>

## Key Features

<div class="feature-grid">
  <div class="feature-card">
    <div class="title">Overnight Mode</div>
    <div class="desc">Unlimited retries on rate limits and network errors. Runs all night unattended.</div>
  </div>
  <div class="feature-card">
    <div class="title">Task State</div>
    <div class="desc">Tracks pending, completed, failed. Resumes where it left off. Retries failures automatically.</div>
  </div>
  <div class="feature-card">
    <div class="title">Smart Planning</div>
    <div class="desc">Reads your codebase before generating tasks. Skips what's already done.</div>
  </div>
  <div class="feature-card">
    <div class="title">Dependencies</div>
    <div class="desc">Tasks can declare depends_on. Topological sort ensures correct execution order.</div>
  </div>
  <div class="feature-card">
    <div class="title">Live Output</div>
    <div class="desc">See what Claude is doing in real-time. Colored stderr/stdout distinction.</div>
  </div>
  <div class="feature-card">
    <div class="title">Git Diffs</div>
    <div class="desc">Saves exactly what Claude changed for each task. Full commit history per run.</div>
  </div>
  <div class="feature-card">
    <div class="title">Webhooks</div>
    <div class="desc">Get notified on Slack, Discord, or any webhook when runs complete.</div>
  </div>
  <div class="feature-card">
    <div class="title">Auto-update</div>
    <div class="desc">CLI checks for updates on startup and installs automatically.</div>
  </div>
</div>

## Safe by design

Claude Code runs inside an **isolated Docker container** — not on your machine.

<div class="safety-grid">
  <div class="safety-item"><strong>Isolated filesystem</strong> — only your project is mounted, nothing else</div>
  <div class="safety-item"><strong>Explicit credentials</strong> — only env vars you configure are injected</div>
  <div class="safety-item"><strong>Dedicated git identity</strong> — not your personal credentials</div>
  <div class="safety-item"><strong>Contained mistakes</strong> — if Claude breaks something, your machine is untouched</div>
</div>

## Get started

1. [Install klaude](installation.md)
2. [Quick Start guide](quickstart.md)
3. [Learn about tasks](tasks.md)
4. [Full command reference](commands.md)

