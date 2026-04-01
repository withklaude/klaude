# Configuration

klaude uses two config files: global (for all projects) and project-level.

## Global config

`~/.klaude/config.yaml` — shared across all projects.

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

## Project config

`.klaude/config.yaml` — per-project overrides.

```yaml
tasks_dir: tasks
docker:
  memory: 8g
mounts:
  - ~/shared-libs
webhooks:
  - url: https://hooks.slack.com/...
    events: [run_complete]
```

Project values override global values.

## Setting values

```bash
# Project config
klaude config set docker.memory 8g

# Global config
klaude config set anthropic.api_key sk-ant-... --global
klaude config set git.user your-name --global
klaude config set env.NPM_TOKEN xxx --global

# View
klaude config get docker.memory
klaude config list
```

## Config keys reference

| Key | Description | Default |
|-----|-------------|---------|
| `anthropic.api_key` | Anthropic API key | (from env/Claude Code) |
| `git.user` | Git username in container | `klaude` |
| `git.email` | Git email in container | `klaude@automated` |
| `git.token` | Git token for push | — |
| `env.<NAME>` | Environment variable in container | — |
| `docker.image` | Local Docker image name | `klaude-ubuntu` |
| `docker.registry_image` | Registry image to pull | `ghcr.io/withklaude/klaude` |
| `docker.memory` | Container memory limit | `4g` |
| `docker.cpus` | Container CPU limit | `2` |
| `docker.rebuild_after_hours` | Rebuild image after N hours | `24` |
| `mounts` | Extra directories to mount | `[]` |
| `tasks_dir` | Tasks directory name | `tasks` |
| `webhooks` | Webhook endpoints | `[]` |
