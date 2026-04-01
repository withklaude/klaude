# Installation

## Prerequisites

- **Node.js** >= 18
- **Docker Desktop** running
- **Claude Code** CLI installed (`npm install -g @anthropic-ai/claude-code`)
- An Anthropic API key or Claude Max/Pro subscription

## Install

```bash
npm install -g klaude-tool
```

The CLI installs as the `klaude` command:

```bash
klaude --version
```

## Auto-update

klaude checks for updates on every startup. If a newer version is available on npm, it updates automatically. No action needed.

## Verify setup

```bash
# Check klaude is installed
klaude --version

# Check Docker is running
docker info

# Check Claude Code is available
claude --version
```

## Initialize a project

```bash
cd your-project
klaude init
```

This creates `.klaude/` in your project and walks you through:
- API key configuration (or detects from Claude Code / environment)
- Git identity for the container (user, email, token)
- Environment variables to inject into the container
