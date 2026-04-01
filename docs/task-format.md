# Task Format Reference

## Supported formats

- **Markdown** (`.md`) — recommended, with YAML frontmatter
- **YAML** (`.yaml`, `.yml`) — full task as YAML
- **JSON** (`.json`) — full task as JSON
- **Directory** — `prompt.md` + optional `config.yaml`

## Markdown (recommended)

```markdown
---
name: add-auth
priority: 2
depends_on:
  - setup-database
settings:
  timeout: 30
---

# Add authentication

## Objective
Implement JWT auth middleware.

## Context
- Express.js app (src/app.ts)
- Database schema in src/db/schema.ts

## Steps
1. Create src/middleware/auth.ts
2. Add login/register routes
3. Protect existing routes

## Acceptance criteria
- [ ] POST /auth/login returns JWT
- [ ] Protected routes reject without token
- [ ] npm test passes
```

## YAML

```yaml
name: add-auth
priority: 2
depends_on:
  - setup-database
settings:
  timeout: 30
prompt: |
  # Add authentication

  Implement JWT auth middleware...
```

## JSON

```json
{
  "name": "add-auth",
  "priority": 2,
  "depends_on": ["setup-database"],
  "settings": { "timeout": 30 },
  "prompt": "# Add authentication\n\nImplement JWT auth middleware..."
}
```

## Directory

```
.klaude/tasks/add-auth/
  prompt.md          # the prompt (required)
  config.yaml        # name, priority, depends_on, settings (optional)
  resources/         # extra files available to the task (optional)
```

## Frontmatter fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Slug: lowercase, alphanumeric, hyphens, underscores |
| `priority` | number | no | Execution order (lower = first). Default: 999 |
| `depends_on` | string[] | no | Task names that must complete first |
| `settings.timeout` | number | no | Max execution time in minutes |
| `settings.max_tokens` | number | no | Token limit for the task |
| `resources` | string[] | no | Extra files to include |
