# Quick Start

## 1. Initialize

```bash
cd your-project
klaude init
```

## 2. Create tasks

**From a spec file:**
```bash
klaude plan spec.md
```

Claude reads your codebase, understands what already exists, and generates only the tasks that are needed. Shows a preview before creating.

**Single task:**
```bash
klaude task generate "add unit tests for the auth module"
```

**Interactive:**
```bash
klaude task new
```

## 3. Run

```bash
# Run all tasks
klaude run --all

# Overnight mode (unlimited retries)
klaude run --overnight

# Single task
klaude run add-unit-tests
```

## 4. Check results

```bash
# Quick overview
klaude task list

# See what Claude committed
git log --oneline -20

# Read logs for a specific task
klaude logs add-unit-tests

# Full run report
klaude status
```

## 5. Fix and retry

If a task failed:
```bash
# Check what went wrong
klaude logs failed-task-name

# Edit the prompt
klaude task edit failed-task-name

# Re-run (only failed/pending tasks execute)
klaude run --all
```

## Example workflow

```bash
# Morning: create a spec
cat > spec.md << 'EOF'
Add a REST API for user management:
- CRUD endpoints for users
- JWT authentication
- Input validation with zod
- Tests with vitest
EOF

# Generate tasks from the spec
klaude plan spec.md

# Preview
klaude run --dry-run

# Run overnight
klaude run --overnight

# Next morning: check results
klaude task list
git log --oneline -20
```
