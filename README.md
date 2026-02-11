<p align="center">
  <img src="website/public/images/logo.png" alt="Pandia Logo" width="120" />
</p>

<h1 align="center">Pandia</h1>

<p align="center">
  <strong>A powerful, cross-platform JSON visualization and editing tool for developers</strong>
</p>

<p align="center">
  <a href="https://github.com/hendurhance/pandia/releases/latest">
    <img src="https://img.shields.io/github/v/release/hendurhance/pandia?style=flat-square" alt="Latest Release" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-Apache%202.0-blue?style=flat-square" alt="License" />
  </a>
  <a href="https://github.com/hendurhance/pandia/releases">
    <img src="https://img.shields.io/github/downloads/hendurhance/pandia/total?style=flat-square" alt="Downloads" />
  </a>
</p>

<p align="center">
  <a href="#installation">Installation</a> •
  <a href="#features">Features</a> •
  <a href="#documentation">Documentation</a> •
  <a href="#development">Development</a> •
  <a href="#contributing">Contributing</a>
</p>

---

Pandia is a free, open-source desktop application that transforms complex JSON data into beautiful, interactive visualizations. Whether you're debugging API responses, exploring data structures, generating types, or comparing JSON documents, Pandia provides the tools you need—all while keeping your data private and local.

## Installation

Download the latest version for your platform:

### macOS

| Chip | Download |
|------|----------|
| Apple Silicon (M1/M2/M3) | [pandia_aarch64.dmg](https://github.com/hendurhance/pandia/releases/latest/download/pandia_aarch64.dmg) |
| Intel | [pandia_x64.dmg](https://github.com/hendurhance/pandia/releases/latest/download/pandia_x64.dmg) |

### Windows

| Type | Download |
|------|----------|
| Installer | [pandia_x64-setup.exe](https://github.com/hendurhance/pandia/releases/latest/download/pandia_x64-setup.exe) |
| Portable (MSI) | [pandia_x64.msi](https://github.com/hendurhance/pandia/releases/latest/download/pandia_x64.msi) |

### Linux

| Format | Download |
|--------|----------|
| AppImage | [pandia_amd64.AppImage](https://github.com/hendurhance/pandia/releases/latest/download/pandia_amd64.AppImage) |
| Debian | [pandia_amd64.deb](https://github.com/hendurhance/pandia/releases/latest/download/pandia_amd64.deb) |

> **System Requirements:** macOS 10.15+, Windows 10+ (64-bit), or Ubuntu 20.04+/Fedora 34+

## Features

### Multiple View Modes
View JSON as tree, graph, grid, or code. Switch between views instantly to explore data your way.

### Type Generation
Generate type definitions from JSON for multiple languages:
- **Languages:** TypeScript, Go, Rust, Python, Java, Kotlin, PHP
- **Schemas:** JSON Schema, Zod, GraphQL, Mongoose, BigQuery, MySQL

### Multi-Format Import
Import data from various sources:
- JSON, YAML, XML, and CSV files
- Drag & drop file loading
- Fetch from URLs and API endpoints
- Parse cURL commands
- Load from GitHub Gists

### Flexible Export
Export your data in multiple formats:
- JSON (pretty/minified), YAML, XML, CSV
- Base64 and URL encoding
- Save to file, send to webhook, or upload to GitHub Gist

### JSON Query
Query and filter your data using:
- JSON Query Language
- JMESPath expressions
- Lodash functions

### Compare & Diff
Compare two JSON documents with:
- Side-by-side comparison view
- Unified diff with highlighted changes
- Structural diff at key-path level

### JSON Repair
Automatically fix malformed JSON:
- Trailing commas
- Unquoted keys
- Missing brackets
- Single quotes instead of double quotes

### Graph Visualization
Transform JSON into interactive node diagrams and export as PNG or SVG.

### Privacy First
- 100% offline operation
- No telemetry or data collection
- All processing happens locally on your machine

## Documentation

For complete documentation, visit the [Pandia Docs](https://pandia.app/docs).

- [Quick Start Guide](https://pandia.app/docs/quick-start)
- [Editor Features](https://pandia.app/docs/editor)
- [Type Generation](https://pandia.app/docs/type-generation)
- [Import & Export](https://pandia.app/docs/import-export)
- [JSON Query](https://pandia.app/docs/query)
- [Keyboard Shortcuts](https://pandia.app/docs/shortcuts)

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) (latest stable) - Install via `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`

**Platform-specific dependencies:**

<details>
<summary><strong>macOS</strong></summary>

```bash
xcode-select --install
```
</details>

<details>
<summary><strong>Windows</strong></summary>

Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "C++ build tools" workload.
</details>

<details>
<summary><strong>Linux (Ubuntu/Debian)</strong></summary>

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```
</details>

### Setup

```bash
# Clone the repository
git clone https://github.com/hendurhance/pandia.git
cd pandia

# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

### Running Tests

```bash
# Run unit tests
npm run test:unit

# Run end-to-end tests
npm run test:e2e

# Run all tests
npm run test:all
```

### Project Structure

```
pandia/
├── src/                  # SvelteKit frontend
│   ├── lib/
│   │   ├── components/   # UI components
│   │   ├── services/     # Business logic
│   │   ├── stores/       # Svelte stores
│   │   └── utils/        # Utility functions
│   └── routes/           # SvelteKit routes
├── src-tauri/            # Rust backend
│   └── src/              # Tauri application code
├── tests/                # Test suites
│   ├── unit/             # Unit tests
│   ├── e2e/              # End-to-end tests
│   └── benchmarks/       # Performance benchmarks
└── website/              # Documentation website
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | [SvelteKit](https://kit.svelte.dev/) + TypeScript |
| Backend | [Tauri](https://tauri.app/) (Rust) |
| Editor | [svelte-jsoneditor](https://github.com/josdejong/svelte-jsoneditor) |
| Build | [Vite](https://vitejs.dev/) |
| Testing | [Vitest](https://vitest.dev/) + [Playwright](https://playwright.dev/) |
| Documentation | [Astro](https://astro.build/) |

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details on:

- Reporting bugs
- Suggesting features
- Submitting pull requests
- Development workflow

## License

Pandia is licensed under the [Apache License 2.0](LICENSE).

## Acknowledgments

Pandia is built on the shoulders of giants. Special thanks to:

### Core Libraries

- [Tauri](https://tauri.app/) - Build smaller, faster, and more secure desktop applications
- [SvelteKit](https://kit.svelte.dev/) - The fastest way to build Svelte apps
- [svelte-jsoneditor](https://github.com/josdejong/svelte-jsoneditor) by **Jos de Jong** - A web-based tool to view, edit, format, and validate JSON

### JSON Processing

- [jsonrepair](https://github.com/josdejong/jsonrepair) by **Jos de Jong** - Repair invalid JSON documents
- [jsondiffpatch](https://github.com/benjamine/jsondiffpatch) by **Benjamín Eidelman** - Diff & patch JavaScript objects
- [jmespath](https://jmespath.org/) - JSON query language
- [JSON Query Language](https://github.com/jsonquerylang/jsonquery) - Query and transform JSON

### Code Generation

- [JSON-to-Go](https://github.com/mholt/json-to-go) by **Matt Holt** - Translate JSON into Go type definitions
- [json_typegen](https://github.com/evestera/json_typegen) by **Erik Vesteraas** - Generate types from JSON (TypeScript, Rust, Kotlin, Python)
- [generate-schema](https://github.com/nijikokun/generate-schema) by **Nijiko Yonskai** - Generate JSON Schema, Mongoose, BigQuery schemas
- [transform](https://github.com/ritz078/transform) by **Ritesh Kumar** - Java type generation approach

### Data Parsing

- [yaml](https://github.com/eemeli/yaml) by **Eemeli Aro** - YAML parser and stringifier
- [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) by **Amit Gupta** - Fast XML to JSON converter
- [PapaParse](https://github.com/mholt/PapaParse) by **Matt Holt** - Fast and powerful CSV parser
- [Lodash](https://lodash.com/) - A modern JavaScript utility library

### Utilities

- [json4u](https://github.com/loggerhead/json4u) by **loggerhead** - Escape/unescape implementation reference
- [Ajv](https://ajv.js.org/) - JSON schema validator
- [highlight.js](https://highlightjs.org/) - Syntax highlighting
- [Ace Editor](https://ace.c9.io/) - High performance code editor
- [Dexie.js](https://dexie.org/) - IndexedDB wrapper

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/hendurhance">hendurhance</a>
</p>