# Contributing to Pandia

Thank you for your interest in contributing to Pandia! This document provides guidelines and information for contributors.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [How to Contribute](#how-to-contribute)
  - [Reporting Bugs](#reporting-bugs)
  - [Suggesting Features](#suggesting-features)
  - [Pull Requests](#pull-requests)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Coding Guidelines](#coding-guidelines)
- [Commit Messages](#commit-messages)
- [Testing](#testing)
- [Documentation](#documentation)

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment. We expect all contributors to:

- Be respectful and considerate in all interactions
- Welcome newcomers and help them get started
- Focus on constructive feedback
- Accept responsibility for mistakes and learn from them

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/pandia.git
   cd pandia
   ```
3. **Add the upstream remote**:
   ```bash
   git remote add upstream https://github.com/hendurhance/pandia.git
   ```
4. **Create a branch** for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## How to Contribute

### Reporting Bugs

Before submitting a bug report:

1. **Search existing issues** to avoid duplicates
2. **Update to the latest version** to see if the bug persists
3. **Collect information** about the bug:
   - Operating system and version
   - Pandia version
   - Steps to reproduce
   - Expected vs actual behavior
   - Screenshots if applicable

**Submit a bug report** by [creating a new issue](https://github.com/hendurhance/pandia/issues/new) with the `bug` label.

### Suggesting Features

We welcome feature suggestions! Before submitting:

1. **Check existing issues and discussions** for similar suggestions
2. **Consider the scope** — does this fit Pandia's goals? Pandia is a focused, native JSON workbench, not a kitchen-sink tool.
3. **Provide context** — why is this feature needed?

**Submit a feature request** by [creating a new issue](https://github.com/hendurhance/pandia/issues/new) with the `enhancement` label.

### Pull Requests

1. **Discuss first** — for significant changes, open an issue to discuss before starting work
2. **Keep PRs focused** — one feature or fix per PR
3. **Update documentation** — if your change affects user-facing features
4. **Add tests** — for new features or bug fixes
5. **Follow coding guidelines** — see [Coding Guidelines](#coding-guidelines)

#### PR Process

1. Ensure your branch is up to date with `main`:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```
2. Run the checks locally before pushing:
   ```bash
   npm run check && npm run lint && npm test
   cd src-tauri && cargo fmt --check && cargo clippy && cd ..
   ```
3. Push your branch and open a PR
4. Wait for review — maintainers will provide feedback
5. Address feedback and push updates
6. Once approved, a maintainer will merge your PR

## Development Setup

### Prerequisites

- **Node.js** 20 or later (LTS recommended)
- **Rust** (latest stable) — install via [rustup](https://rustup.rs/)
- **Platform-specific tools**:
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Windows**: Visual Studio Build Tools with the "Desktop development with C++" workload
  - **Linux**: `webkit2gtk` and friends — see the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/)

Pandia is built with **Tauri 2** (Rust backend) and **SvelteKit + Svelte 5** (frontend), bundled by **Vite**.

### Installation

```bash
# Install frontend dependencies
npm install

# Run the app in development (frontend + Tauri shell)
npm run tauri dev
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run tauri dev` | Run the full app (Rust + webview) in development |
| `npm run tauri build` | Build the production app and platform installers |
| `npm run dev` | Run the frontend only (Vite dev server) |
| `npm run build` | Build the frontend bundle |
| `npm run check` | Type-check the frontend (`svelte-check`) |
| `npm run lint` / `lint:fix` | Lint with ESLint |
| `npm run format` / `format:check` | Format / check with Prettier |
| `npm test` / `npm run test:watch` | Run unit tests (Vitest) |

A **husky** pre-commit hook runs **lint-staged** (ESLint + Prettier on staged files), so formatting/lint issues are caught before they land.

## Project Structure

```
pandia/
├── src/                         # SvelteKit frontend (Svelte 5 + runes)
│   ├── app.html
│   ├── app.css
│   ├── routes/                  # SvelteKit routes (app entry + sandbox)
│   ├── styles/                  # global styles
│   └── lib/
│       ├── views/               # the five views: tree, code, grid, graph, compare
│       ├── docpane/             # document canvas + view orchestration
│       ├── panels/              # sidebar panels (outline, schema, types, history) + type generation
│       ├── shell/               # app shell — tabs, sidebar, status bar, start screen, themes
│       │   ├── components/
│       │   ├── logic/           # theme palettes, command registries, …
│       │   └── state/
│       ├── palette/             # command palette (⌘K)
│       ├── find/                # find & replace
│       ├── settings/            # settings & preferences
│       ├── ipc/                 # typed bindings to the Rust commands
│       ├── ui/                  # generic UI components
│       └── util/                # utilities (flags, paths, …)
├── src-tauri/                   # Rust backend (Tauri 2)
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs
│   │   ├── commands.rs          # Tauri command handlers (frontend ↔ Rust)
│   │   └── doc/                 # the JSON engine
│   │       ├── document.rs      # open documents; eager vs. lazy backing
│   │       ├── lazy.rs / eager.rs   # lazy zero-copy slicing for large files
│   │       ├── detect.rs        # format auto-detect & convert (JSON/YAML/XML/CSV/cURL)
│   │       ├── typegen.rs       # type generation (9 targets)
│   │       ├── diff.rs          # compare / diff
│   │       ├── repair.rs        # repair malformed JSON
│   │       ├── schema_validate.rs   # JSON Schema validation
│   │       ├── export.rs        # export (JSON / YAML / CSV / XML)
│   │       ├── grid_filter.rs   # grid column filters
│   │       ├── history.rs       # per-tab undo / redo
│   │       └── search.rs, ops.rs, store.rs, backup.rs, …
│   ├── Cargo.toml
│   └── tauri.conf.json
└── website/                     # marketing + docs site (Astro)
```

Unit tests live **next to the code** they cover as `*.test.ts` (e.g. `src/lib/util/path.test.ts`).

## Coding Guidelines

### TypeScript / Svelte

- Use **TypeScript** for all new code.
- This is **Svelte 5** — use runes (`$state`, `$derived`, `$effect`) and match the surrounding patterns.
- Use meaningful names and keep components small and focused.
- Favor **self-documenting code**; add a comment only where the context is genuinely non-obvious (a constraint, a cross-file coupling, a why).

```typescript
// Good — explicit, typed, errors handled
function parseJsonSafely(input: string): Result<unknown, ParseError> {
  try {
    return { ok: true, value: JSON.parse(input) };
  } catch (error) {
    return { ok: false, error: new ParseError(String(error)) };
  }
}

// Avoid — untyped, swallows failures
function parse(s) {
  return JSON.parse(s);
}
```

### Rust

- Follow Rust idioms; the JSON engine lives in `src-tauri/src/doc/`.
- Run `cargo fmt` and `cargo clippy` before pushing.
- Handle errors with `Result`; surface them to the frontend through `commands.rs`.

### Styling

- The app uses **scoped Svelte styles + CSS custom properties** — there is **no Tailwind / utility framework**.
- Use the theme tokens rather than hard-coded colors; Pandia ships 19 themes, so **test in both light and dark**.
- Follow the existing design system (square corners, IBM Plex Mono).

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code changes that neither fix bugs nor add features
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `chore`: Build process or auxiliary tool changes

### Examples

```
feat(typegen): add Kotlin target

fix(diff): correct highlighting for moved keys

docs(readme): update installation instructions

refactor(shell): simplify tab management logic
```

## Testing

### Unit tests (Vitest)

Tests are co-located with the code as `*.test.ts`. Run them with:

```bash
npm test          # one-off
npm run test:watch
```

```typescript
import { describe, it, expect } from 'vitest';
import { joinPath } from './path';

describe('joinPath', () => {
  it('joins segments', () => {
    expect(joinPath(['a', 'b'])).toBe('a/b');
  });
});
```

### Rust tests

Backend tests run with Cargo:

```bash
cd src-tauri
cargo test
```

When adding a feature or fixing a bug, include a test that covers it.

## Documentation

- Update the **README** if you change user-facing features.
- Update the **docs site** for significant features (`website/src/pages/docs/`).
- Keep comments minimal — only where the context is really important.

## Questions?

If you have questions, feel free to:

- Open a [GitHub Discussion](https://github.com/hendurhance/pandia/discussions)
- Ask in an existing issue

Thank you for contributing to Pandia!
