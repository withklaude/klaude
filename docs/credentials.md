# Credentials

## Anthropic API

klaude resolves the API key in this order:

1. **Explicit config** — `klaude config set anthropic.api_key <key> --global`
2. **Environment variable** — `ANTHROPIC_API_KEY`
3. **Claude Code config** — `~/.claude/.credentials.json` (OAuth token from Claude Max/Pro)

### API key (recommended for overnight)

```bash
klaude config set anthropic.api_key sk-ant-... --global
```

API keys don't expire — best for unattended overnight runs.

### Claude Max/Pro (OAuth)

If you use Claude Max or Pro, klaude mounts `~/.claude` into the container. Claude Code uses the OAuth token to authenticate.

> **Note:** OAuth tokens can expire during long runs. If you see "Invalid API key" errors, consider using an API key instead for overnight runs.

## Git credentials

Configure git identity and push access:

```bash
klaude config set git.user your-name --global
klaude config set git.email you@email.com --global
klaude config set git.token ghp_... --global
```

The git token enables Claude to push commits from inside the container.

## Environment variables

Inject any credentials as environment variables:

```bash
klaude config set env.NPM_TOKEN npm_... --global
klaude config set env.SONAR_TOKEN xxx --global
klaude config set env.AWS_ACCESS_KEY_ID xxx --global
```

These are available inside the container as standard environment variables. Claude Code can use them to run builds, tests, deploys, etc.

The variable names (not values) are appended to each task prompt so Claude knows what's available.

## Security

- Credentials are stored in `~/.klaude/config.yaml` on your machine
- Secret values are masked in `klaude config list` output
- Credentials are passed to the container via environment variables (not written to disk inside the container)
- The container runs in an isolated Docker environment
