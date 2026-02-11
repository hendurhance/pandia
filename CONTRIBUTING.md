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
2. **Consider the scope** - does this fit Pandia's goals?
3. **Provide context** - why is this feature needed?

**Submit a feature request** by [creating a new issue](https://github.com/hendurhance/pandia/issues/new) with the `enhancement` label.

### Pull Requests

1. **Discuss first** - For significant changes, open an issue to discuss before starting work
2. **Keep PRs focused** - One feature or fix per PR
3. **Update documentation** - If your change affects user-facing features
4. **Add tests** - For new features or bug fixes
5. **Follow coding guidelines** - See [Coding Guidelines](#coding-guidelines)

#### PR Process

1. Ensure your branch is up to date with `main`:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```
2. Push your branch and create a PR
3. Fill out the PR template with relevant information
4. Wait for review - maintainers will provide feedback
5. Address feedback and push updates
6. Once approved, a maintainer will merge your PR

## Development Setup

### Prerequisites

- **Node.js** 18 or later
- **Rust** (latest stable) - Install via [rustup](https://rustup.rs/)
- **Platform-specific tools**:
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Windows**: Visual Studio Build Tools with C++ workload
  - **Linux**: See [Tauri prerequisites](https://tauri.app/v1/guides/getting-started/prerequisites#setting-up-linux)

### Installation

```bash
# Install Node.js dependencies
npm install

# Start development server
npm run tauri dev
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run tauri dev` | Start the app in development mode |
| `npm run tauri build` | Build for production |
| `npm run test:unit` | Run unit tests |
| `npm run test:e2e` | Run end-to-end tests |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run check` | Type-check the codebase |

## Project Structure

```
pandia/
├── src/                      # SvelteKit frontend
│   ├── lib/
│   │   ├── components/       # Reusable UI components
│   │   │   ├── layout/       # Layout components
│   │   │   ├── modals/       # Modal dialogs
│   │   │   ├── ui/           # Generic UI elements
│   │   │   └── views/        # View-specific components
│   │   ├── services/         # Business logic and API services
│   │   ├── stores/           # Svelte stores for state management
│   │   └── utils/            # Utility functions
│   ├── routes/               # SvelteKit routes
│   └── types/                # TypeScript type definitions
├── src-tauri/                # Rust backend (Tauri)
│   ├── src/                  # Rust source code
│   └── Cargo.toml            # Rust dependencies
├── tests/                    # Test suites
│   ├── unit/                 # Unit tests
│   ├── e2e/                  # End-to-end tests (Playwright)
│   └── benchmarks/           # Performance benchmarks
└── website/                  # Documentation website (Astro)
```

## Coding Guidelines

### TypeScript/Svelte

- Use TypeScript for all new code
- Follow the existing code style
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Prefer functional programming patterns
- Keep components small and focused

```typescript
// Good
function parseJsonSafely(input: string): Result<unknown, ParseError> {
  try {
    return { ok: true, value: JSON.parse(input) };
  } catch (error) {
    return { ok: false, error: new ParseError(error.message) };
  }
}

// Avoid
function parse(s) {
  return JSON.parse(s);
}
```

### Rust

- Follow Rust idioms and best practices
- Use `clippy` for linting
- Handle errors properly with `Result` types
- Add documentation comments for public items

### CSS/Styling

- Use Tailwind CSS utility classes
- Follow the existing design system
- Ensure responsive design
- Test with both light and dark themes

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
feat(editor): add support for YAML import

fix(diff): correct highlighting for nested objects

docs(readme): update installation instructions

refactor(stores): simplify tab management logic
```

## Testing

### Unit Tests

Located in `tests/unit/`. Run with:

```bash
npm run test:unit
```

When adding new features, include unit tests:

```typescript
import { describe, it, expect } from 'vitest';
import { parseJson } from '$lib/services/json';

describe('parseJson', () => {
  it('should parse valid JSON', () => {
    const result = parseJson('{"key": "value"}');
    expect(result).toEqual({ key: 'value' });
  });

  it('should throw on invalid JSON', () => {
    expect(() => parseJson('invalid')).toThrow();
  });
});
```

### End-to-End Tests

Located in `tests/e2e/`. Run with:

```bash
npm run test:e2e
```

E2E tests use Playwright and test the full application flow.

### Test Coverage

We aim for good test coverage. Run coverage reports with:

```bash
npm run test:coverage
```

## Documentation

- Update the README if you change user-facing features
- Add JSDoc comments to public functions and components
- Update the website documentation for significant features (`website/src/pages/docs/`)

## Questions?

If you have questions, feel free to:

- Open a [GitHub Discussion](https://github.com/hendurhance/pandia/discussions)
- Ask in an existing issue

Thank you for contributing to Pandia!
