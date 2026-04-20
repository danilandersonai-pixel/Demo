# CLAUDE.md

This file provides guidance for AI assistants (Claude, Copilot, etc.) working in this repository. Keep this file up to date as the project evolves.

---

## Project Overview

> **TODO:** Replace this section with a description of what this project does, who it's for, and its current status.

- **Name:** Demo
- **Purpose:** _[Describe the project purpose here]_
- **Tech Stack:** _[e.g. Python 3.12 / FastAPI / PostgreSQL, or Node 20 / React / SQLite]_
- **Status:** _[e.g. Early development / Active / Maintenance]_

---

## Repository Structure

```
/
├── CLAUDE.md          # This file — AI assistant guidance
├── README.md          # Human-facing project documentation
├── .github/
│   └── workflows/     # CI/CD pipeline definitions
├── src/               # Primary source code
├── tests/             # Test suites
├── docs/              # Additional documentation
└── scripts/           # Utility/automation scripts
```

> **TODO:** Update this tree to reflect the actual layout once files are added.

---

## Development Setup

### Prerequisites

> **TODO:** List required tools and versions (e.g. Node >= 20, Python >= 3.12, Docker).

```bash
# Example: install dependencies
npm install          # JavaScript/TypeScript projects
# or
pip install -e ".[dev]"   # Python projects
```

### Environment Variables

Copy `.env.example` to `.env` and fill in values before running locally:

```bash
cp .env.example .env
```

| Variable | Description | Required |
|----------|-------------|----------|
| `APP_ENV` | Runtime environment (`development`, `production`) | Yes |

> **TODO:** Add all environment variables here as they are introduced.

---

## Common Commands

> **TODO:** Fill in the actual commands for this project.

```bash
# Install dependencies
<install-command>

# Start development server
<dev-command>

# Run tests
<test-command>

# Lint / format check
<lint-command>

# Build for production
<build-command>
```

---

## Architecture & Key Conventions

### Code Style

- Follow the formatter and linter config committed to the repository (e.g. Prettier, ESLint, Black, Ruff).
- Run the linter before committing — CI will enforce it.
- Prefer explicit over implicit: clear variable names, small focused functions.

### Naming Conventions

| Context | Convention |
|---------|-----------|
| Files (JS/TS) | `kebab-case.ts` |
| Files (Python) | `snake_case.py` |
| Classes | `PascalCase` |
| Functions / variables | `camelCase` (JS/TS) or `snake_case` (Python) |
| Constants | `UPPER_SNAKE_CASE` |
| Environment variables | `UPPER_SNAKE_CASE` |

> **TODO:** Update table to match the actual stack and conventions.

### Comments

Write comments only when the **why** is non-obvious — hidden constraints, subtle invariants, workarounds for specific bugs. Do not describe what the code does; well-named identifiers already do that.

---

## Testing

> **TODO:** Describe the test framework and directory structure.

- Tests live in `tests/` (or colocated `*.test.ts` / `*_test.py` files).
- Unit tests cover individual functions/modules in isolation.
- Integration tests cover cross-module flows and external dependencies.
- All new features and bug fixes must include tests.
- CI runs the full test suite on every pull request.

```bash
# Run all tests
<test-command>

# Run a specific test file
<test-command> <path/to/test>

# Run with coverage
<test-command> --coverage
```

---

## Git Workflow

### Branches

| Branch pattern | Purpose |
|----------------|---------|
| `main` | Production-ready code; protected |
| `develop` | Integration branch (if used) |
| `feature/<short-description>` | New features |
| `fix/<short-description>` | Bug fixes |
| `chore/<short-description>` | Maintenance, tooling, docs |

### Commit Messages

Use the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<optional scope>): <short summary>

[optional body — explain WHY, not WHAT]
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `ci`

**Examples:**
```
feat(auth): add JWT refresh token rotation
fix(api): handle null user in /profile response
docs: update setup instructions in CLAUDE.md
```

### Pull Requests

- Open a PR against `main` (or `develop` if that branch exists).
- PR title should follow the commit message format above.
- Ensure CI passes before requesting review.
- Squash-merge preferred to keep history clean.

---

## AI Assistant Guidelines

Rules specific to AI tools (Claude Code, Copilot, etc.) working in this repository:

1. **Read before editing.** Always read the file you intend to change before making edits.
2. **Minimal changes.** Make the smallest diff that correctly addresses the task. Do not refactor surrounding code unless explicitly asked.
3. **No speculative features.** Do not add error handling, fallbacks, or abstractions for scenarios not described in the task.
4. **No comments that describe what.** Only add a comment when the *why* is genuinely non-obvious.
5. **No documentation files unless asked.** Do not create new `.md` files (other than this one) without explicit instruction.
6. **Test your changes.** Run the relevant test suite and linter before reporting a task complete.
7. **Security.** Do not introduce SQL injection, XSS, command injection, or other OWASP Top 10 vulnerabilities. Never commit secrets or credentials.
8. **Destructive operations require confirmation.** Ask before running `rm -rf`, `git reset --hard`, `git push --force`, or dropping database tables.
9. **Branch discipline.** Develop on the feature branch specified for the task; never push directly to `main` without explicit approval.
10. **Keep this file current.** When the project structure, commands, or conventions change, update the relevant section of this file in the same PR.
