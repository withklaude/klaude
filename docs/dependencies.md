# Task Dependencies

Tasks can declare dependencies to enforce execution order.

## Usage

Add `depends_on` to the task frontmatter:

```markdown
---
name: implement-api
priority: 2
depends_on:
  - setup-database
---
```

This task will only run after `setup-database` completes successfully.

## How it works

1. **Topological sort** — tasks are reordered so dependencies run first, regardless of priority
2. **Validation** — before running, klaude checks for missing dependencies, self-references, and cycles
3. **Runtime** — if a dependency fails, all tasks that depend on it are skipped

## Validation

```bash
klaude task validate
```

Detects:
- **Missing dependencies** — `depends_on` names a task that doesn't exist
- **Self-references** — a task depends on itself
- **Cycles** — A depends on B, B depends on A

## Priority vs dependencies

- **Priority** orders tasks when there are no dependencies (lower = runs first)
- **Dependencies** override priority — a P1 task that depends on a P3 task waits for it
- Tasks without dependencies keep their priority ordering

## Example

```yaml
# setup-schema.md — P1, no deps
---
name: setup-schema
priority: 1
---

# implement-api.md — P2, depends on schema
---
name: implement-api
priority: 2
depends_on:
  - setup-schema
---

# add-tests.md — P3, depends on API
---
name: add-tests
priority: 3
depends_on:
  - implement-api
---

# update-docs.md — P4, no deps (runs after schema by priority)
---
name: update-docs
priority: 4
---
```

Execution order: `setup-schema` → `implement-api` → `add-tests` → `update-docs`
