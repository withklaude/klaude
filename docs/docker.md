# Docker

klaude runs Claude Code inside Docker containers for isolation and reproducibility.

## Image

The default image (`klaude-ubuntu`) includes:
- Ubuntu 24.04
- Node.js 22
- Claude Code CLI
- Git, curl, sudo

## Image management

On first run, klaude pulls the image from `ghcr.io/withklaude/klaude`. If the pull fails (offline, private network), it builds the image locally from the bundled Dockerfile.

The image is automatically rebuilt every 24 hours to keep Claude Code up to date. Configure this:

```bash
klaude config set docker.rebuild_after_hours 48 --global
```

## Container lifecycle

1. **One container per run** — all tasks share the same container
2. Container starts with your project mounted at `/workspace`
3. Git, env vars, and Claude credentials are configured inside
4. Tasks execute sequentially — changes from task N are visible to task N+1
5. Container is stopped and removed when the run finishes

## Resource limits

```bash
klaude config set docker.memory 8g --global
klaude config set docker.cpus 4 --global
```

## Extra mounts

Mount additional directories into the container:

```yaml
# .klaude/config.yaml
mounts:
  - ~/shared-libs
  - /opt/data
```

Mounted as read-only at `/mnt/<dirname>`.

## Custom image

Use a custom Docker image:

```bash
klaude config set docker.image my-custom-image --global
```

Your image must have Node.js and Claude Code CLI installed. The container runs as a non-root user.

## Concurrent runs

You can run klaude in multiple project directories simultaneously. Each project gets its own container. A lock file prevents concurrent image rebuilds.

## Healthcheck

Before running tasks, klaude verifies:
1. Container is responsive
2. Git is available
3. Claude Code CLI is installed
4. Project is mounted at `/workspace`
5. API key or Claude credentials are present
