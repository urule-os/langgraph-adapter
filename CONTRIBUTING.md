# Contributing to Urule

Thank you for your interest in contributing! Urule is an open platform for making AI more usable, and we welcome contributions from everyone.

## Getting Started

1. **Fork** the repository
2. **Clone** your fork locally
3. **Install dependencies**: `npm install`
4. **Build**: `npm run build`
5. **Test**: `npm test`

## Development Setup

- **Runtime**: Node.js 20+
- **Language**: TypeScript (ESM modules)
- **HTTP Framework**: Fastify 5
- **Test Runner**: Vitest
- **Database**: PostgreSQL 16 (services that need persistence)
- **Events**: NATS (inter-service communication)

## Code Style

- ESM-only (`"type": "module"` in package.json)
- TypeScript strict mode
- Use `ulid()` for ID generation
- Prefer Fastify plugins and decorators

## Making Changes

1. Create a feature branch from `main`
2. Make your changes
3. Add or update tests as needed
4. Ensure `npm run build` and `npm test` pass
5. Commit with a clear message (e.g., `feat: add webhook retry logic`)
6. Open a Pull Request

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation only
- `refactor:` — code change that neither fixes a bug nor adds a feature
- `test:` — adding or updating tests
- `chore:` — maintenance tasks

## Reporting Issues

- Use GitHub Issues to report bugs or request features
- Include steps to reproduce for bugs
- For security issues, please email the maintainers directly

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
