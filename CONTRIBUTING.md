# Contributing to klaude

Thanks for your interest in contributing! Here's everything you need to get started.

## Getting Started

1. **Fork** the repository on GitHub.
2. **Clone** your fork:
   ```bash
   git clone https://github.com/<your-username>/klaude.git
   cd klaude
   ```
3. **Install dependencies:**
   ```bash
   npm install
   ```
4. **Build:**
   ```bash
   npm run build
   ```
5. **Link for local testing:**
   ```bash
   npm link
   ```
   Now `klaude` is available globally and points to your local build.

## Development workflow

1. Create a branch from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```
2. Make your changes.
3. Build and test locally:
   ```bash
   npm run build
   klaude --help
   ```
4. Commit with a clear message:
   ```bash
   git commit -m "feat: add support for task timeouts"
   ```
5. Push to your fork and open a Pull Request against `main`.

## Code style

- **TypeScript strict mode** — `tsconfig.json` has `strict: true`. Do not weaken it.
- **ESM only** — the project uses `"type": "module"`. Use `import`/`export`, not `require`.
- **No `any`** — use `unknown` and narrow when the type is genuinely unclear.
- **Naming** — camelCase for variables and functions, PascalCase for types and classes, kebab-case for file names.
- **Minimal dependencies** — justify new dependencies in the PR description.

## Project structure

```
src/
  index.ts          # CLI entry point (Commander setup)
  commands/         # one file per command group
  core/             # business logic (Docker, config, state, rate limiting)
  types/            # shared TypeScript types
  templates/        # Dockerfile, agent prompts, task template
```

## Pull Request guidelines

- Keep PRs focused — one feature or fix per PR.
- Describe what changed and why.
- If the PR adds a command or flag, update the README.
- If the PR changes config keys, update the config reference in the README.

## Reporting issues

Open an issue on GitHub. Include:

- klaude version (`klaude --version`)
- Node.js version (`node --version`)
- Docker version (`docker --version`)
- Operating system
- Steps to reproduce
- Expected vs actual behavior

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
