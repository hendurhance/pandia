<p align="center">
  <img src="website/public/logo.svg" alt="Pandia" width="120" />
</p>

<h1 align="center">Pandia</h1>

<p align="center">
  <strong>A JSON IDE built for files the rest of your tools choke on.</strong>
</p>

<p align="center">
  Open multi-gigabyte documents instantly. Navigate as a tree, code, table, or node graph.<br/>
  Diff, search, filter, generate types, validate against schemas — all locally, nothing leaves your machine.
</p>

<p align="center">
  <a href="https://github.com/hendurhance/pandia/releases/latest">
    <img src="https://img.shields.io/github/v/release/hendurhance/pandia?style=flat-square&color=D6571F" alt="Latest release" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-Apache%202.0-blue?style=flat-square" alt="License" />
  </a>
  <a href="https://github.com/hendurhance/pandia/releases">
    <img src="https://img.shields.io/github/downloads/hendurhance/pandia/total?style=flat-square" alt="Downloads" />
  </a>
</p>

<p align="center">
  <a href="https://www.pandia.app">Website</a> ·
  <a href="#installation">Installation</a> ·
  <a href="#features">Features</a> ·
  <a href="https://www.pandia.app/docs">Docs</a> ·
  <a href="#building-from-source">Build</a> ·
  <a href="https://github.com/hendurhance/pandia/issues/new">Report issue</a>
</p>

---

## Why Pandia

Most JSON editors hit a wall around 50–100 MB — the tab freezes, the scrollbar dies, "expand all" never finishes. Pandia's document model lives in Rust with a lazy parser that keeps the UI responsive on **multi-gigabyte files**. Everything you need to interrogate a JSON document — open, browse, search, diff, validate, transform — lives in one window. No popups. No network round-trips. No telemetry.

## Features

### Open anything, at any size

- **Lazy parsing above 10 MB.** Children parsed on demand; a root-array offset index gives O(slice) random access regardless of file size.
- **Big-number safe.** Snowflake IDs, BigQuery int64s, Stripe IDs, nanosecond timestamps — preserved literally, never coerced through `f64`.
- **Multi-format detect on paste.** JSON · JSONL · NDJSON · JSONC · JSON5 · GeoJSON · YAML · XML · CSV · cURL — pick the right one automatically.
- **Repair broken JSON.** Trailing commas, unquoted keys, single quotes, comments, BOMs, JSONP wrappers, unterminated strings — fixed before the editor gives up on you.

### Four lenses on the same document

| View | What it's for |
|---|---|
| **Tree** | Virtualised, click-to-menu editing, indentation guides, path breadcrumb, jump-to-anywhere |
| **Code** | CodeMirror 6 with syntax highlighting, fold/unfold, inline find / replace |
| **Grid** | Homogeneous arrays as a spreadsheet — column filters, sort, multi-row select, type-aware cells |
| **Graph** | Node-link visualisation with click-through to tree; export PNG · JPEG · SVG |

### Compare and contrast

- Split-canvas diff against another open tab or any file on disk.
- Three modes: **side-by-side**, **unified inline**, **tree-with-highlights**.
- Sync scroll, jump-to-next-change, 50-line LCS chunking so even gigabyte-scale diffs stay navigable.

### Generate types

One click, **nine targets**:

<p align="center">
  TypeScript · Zod · Go · Rust · Kotlin · Python · PHP · Java · JSON Schema
</p>

### Validate against schemas

Inline JSON Schema validation against **draft-07** and **2020-12**. Debounce is user-tunable: immediate, 250 ms, 500 ms, 1 s, 2 s, or manual.

### Privacy-first by design

100% local. No telemetry. No cloud sync. No account. Preferences and per-document state live in plain-store files in your OS app-data directory; nothing leaves the machine.

## Installation

Download the latest version for your platform from [releases](https://github.com/hendurhance/pandia/releases/latest):

### macOS

| Chip | Download |
|---|---|
| Apple Silicon (M1 / M2 / M3 / M4 / M5 and newer) | [`Pandia_1.0.0_aarch64.dmg`](https://github.com/hendurhance/pandia/releases/latest/download/Pandia_1.0.0_aarch64.dmg) |
| Intel | [`Pandia_1.0.0_x64.dmg`](https://github.com/hendurhance/pandia/releases/latest/download/Pandia_1.0.0_x64.dmg) |

The macOS bundle is signed and notarised.

### Windows

| Type | Download |
|---|---|
| Installer | [`Pandia_1.0.0_x64-setup.exe`](https://github.com/hendurhance/pandia/releases/latest/download/Pandia_1.0.0_x64-setup.exe) |
| MSI | [`Pandia_1.0.0_x64_en-US.msi`](https://github.com/hendurhance/pandia/releases/latest/download/Pandia_1.0.0_x64_en-US.msi) |

### Linux

| Format | Download |
|---|---|
| AppImage | [`Pandia_1.0.0_amd64.AppImage`](https://github.com/hendurhance/pandia/releases/latest/download/Pandia_1.0.0_amd64.AppImage) |
| Debian / Ubuntu | [`Pandia_1.0.0_amd64.deb`](https://github.com/hendurhance/pandia/releases/latest/download/Pandia_1.0.0_amd64.deb) |

Linux bundles are GPG-signed; the public key is published with each release.

> **System requirements:** macOS 10.15+, Windows 10+ (64-bit), Ubuntu 22.04+ / Fedora 38+ (or any glibc 2.35+ distro with WebKitGTK 4.1).

## Quick start

1. Launch Pandia.
2. Drag a JSON file onto the canvas — or paste / fetch by URL from the empty state.
3. Switch between **Tree · Code · Grid · Graph** from the top bar (`⌘1` … `⌘4`).
4. Press `⌘K` for the command palette. Every action is reachable from there.

## Keyboard reference

| | |
|---|---|
| `⌘K` | Command palette |
| `⌘O` | Open file |
| `⌘T` / `⌘W` | New tab / Close tab |
| `⌘⇧]` / `⌘⇧[` | Next / previous tab |
| `⌘F` | Find |
| `⌘G` / `⌘⇧G` | Find next / previous |
| `⌘H` | Find and replace |
| `⌘D` | Compare against tab or file |
| `⌘B` | Toggle sidebar |
| `⌘S` / `⌘⇧S` | Save / Save As |
| `⌘E` | Export |
| `⌘Z` / `⌘⇧Z` | Undo / Redo |
| `⌘1` / `⌘2` / `⌘3` / `⌘4` | Tree / Code / Grid / Graph |
| `⌘⇧V` | Validate JSON |
| `⌘/` | Keyboard shortcuts |
| `⌘,` | Settings |

Use `Ctrl` on Linux / Windows.

## Architecture at a glance

> The pitch in one paragraph: **the document lives in Rust. The UI renders slices of it.**

| Rust owns | UI owns |
|---|---|
| Parsed document, one per tab, addressed by handle | Expansion state, selection, scroll position |
| All structural ops (set · insert · delete · sort · move) | Current edit-in-progress buffer until commit |
| Query · diff · repair · validate · typegen · format · export | Active search query, current match index |
| Search indexing and execution | Layout, theme, panel and sidebar visibility |
| Undo / redo (op log, per tab, 500-op cap) | Tab list and active-tab indicator |
| Document version counter | — |

Anything that's *where the user is looking* stays in Svelte. Anything that's *what the document is* lives in Rust.

### File-size tiers

| Size | Behaviour |
|---|---|
| < 10 MB | Eager parse — full feature set |
| 10 MB – 200 MB | Lazy mode — full feature set |
| 200 MB –  GB | Lazy mode — browse, search, diff, export; whole-document edit / validate disabled |
| > 2 GB | Refused in v1 — streaming view planned for v1.x |

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | [Svelte 5](https://svelte.dev) (runes) · [SvelteKit](https://kit.svelte.dev) · TypeScript |
| Backend | [Rust](https://www.rust-lang.org) · [Tauri 2](https://tauri.app) |
| JSON parser | [`sonic-rs`](https://github.com/cloudwego/sonic-rs) (lazy mode) with `serde_json` fallback |
| Code view | [CodeMirror 6](https://codemirror.net) |
| Schema validation | [`jsonschema`](https://crates.io/crates/jsonschema) |
| Concurrency | `parking_lot` · `dashmap` |
| Build | [Vite](https://vitejs.dev) |
| Docs site | [Astro](https://astro.build) |
| Bundle size | < 500 KB gzipped JS |

## Building from source

### Prerequisites

- **Node.js** LTS — [nodejs.org](https://nodejs.org)
- **Rust** stable — `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- **Tauri 2 system prerequisites** — see [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/)

<details>
<summary><strong>macOS</strong></summary>

```bash
xcode-select --install
```
</details>

<details>
<summary><strong>Windows</strong></summary>

Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "C++ build tools" workload, plus WebView2 (preinstalled on Windows 11).
</details>

<details>
<summary><strong>Linux (Ubuntu / Debian)</strong></summary>

```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf \
  build-essential curl wget file libssl-dev libgtk-3-dev
```
</details>

### Setup

```bash
git clone https://github.com/hendurhance/pandia
cd pandia
npm ci

npm run tauri dev      # development build, hot-reload
npm run tauri build    # release build for the current platform
```

### Useful commands

```bash
# Frontend
npm run check          # svelte-check (TypeScript)
npm run lint           # eslint
npm run format:check   # prettier
npm run test           # vitest

# Backend
cd src-tauri
cargo test --lib       # rust unit tests
cargo fmt --check      # rustfmt
cargo clippy --all-targets
```

CI runs all of the above on every push to `main` and every pull request.

### Project layout

```
pandia/
├── src/                                 SvelteKit frontend
│   ├── lib/
│   │   ├── docpane/                     per-tab editor shell
│   │   ├── views/{tree,code,grid,graph,compare}/   the four lenses + diff
│   │   ├── shell/                       app shell, tab store, menu, status bar
│   │   ├── panels/                      sidebar tabs (outline, schema, types, history)
│   │   ├── settings/                    settings route + per-panel state
│   │   ├── find/                        find / replace controller
│   │   ├── palette/                     command palette
│   │   ├── ipc/                         typed wrappers around Tauri commands
│   │   └── util/                        shared utilities
│   └── routes/                          SvelteKit routes (single SPA shell)
├── src-tauri/
│   └── src/
│       ├── doc/                         document model, ops, lazy parser
│       ├── commands.rs                  Tauri command surface
│       └── lib.rs                       Tauri app setup, menus, file associations
└── website/                             marketing + docs (separate Astro project)
```

Want to read the code? Start here:

- `src-tauri/src/doc/document.rs` — the document model and size-tier behaviours
- `src-tauri/src/doc/lazy.rs` — the lazy parser and slice protocol
- `src/lib/docpane/components/DocPane.svelte` — the per-tab editor
- `src/lib/shell/components/AppShell.svelte` — the application shell

## Roadmap

### v1.x

- Drag-to-reorder tree nodes
- File watcher for auto-reload on disk change
- Schema-driven autocomplete in tree edits
- Op-log crash recovery (currently snapshot-based)
- Optional JSONPath / jq-style expression bar
- Batch operations mode
- Streaming view for files > 1 GB

### v2

Not currently scoped. Open an issue if you have a request.

See [open issues](https://github.com/hendurhance/pandia/issues) for what's being worked on now.

## Contributing

Pull requests and bug reports are welcome. For non-trivial changes, please open an issue first to discuss the approach.

Before opening a PR:

- All Rust code passes `cargo fmt`, `cargo clippy --all-targets`, and `cargo test`.
- All frontend code passes `npm run check`, `npm run lint`, `npm run format:check`, and `npm run test`.
- PR titles should read like a release-note line.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

## License

Pandia is licensed under the [Apache License 2.0](LICENSE).

## Acknowledgments

Pandia stands on the shoulders of giants. Particular thanks to:

### Runtime and framework

- [Tauri](https://tauri.app) — makes this a real desktop app, not an Electron box
- [Svelte](https://svelte.dev) — runes made the reactive controllers in `src/lib/**/state/*.svelte.ts` actually pleasant to write
- [SvelteKit](https://kit.svelte.dev) — the SPA scaffolding

### JSON processing

- [`sonic-rs`](https://github.com/cloudwego/sonic-rs) — the lazy parser doing the heavy lifting
- [`serde_json`](https://github.com/serde-rs/json) — the fallback eager parser
- [`jsonschema`](https://crates.io/crates/jsonschema) — JSON Schema validation
- [`jaq`](https://github.com/01mf02/jaq) — jq engine reference for future query support

### Editing

- [CodeMirror 6](https://codemirror.net) — the code view foundation
- [`@lucide/svelte`](https://github.com/lucide-icons/lucide) — icon set

### Reference and inspiration

- [jsoneditoronline.org](https://jsoneditoronline.org) by **Jos de Jong** — the reference target for tree-mode interactions
- [`jsonrepair`](https://github.com/josdejong/jsonrepair) by **Jos de Jong** — algorithm reference for the Rust port

### Typography

- IBM Plex Mono, plus bundled Cascadia Code, Fira Code, Geist Mono, JetBrains Mono, DM Mono, Inconsolata, Roboto Mono, Source Code Pro, Space Mono, Ubuntu Mono, Victor Mono — via the `@fontsource` packages.

---

<p align="center">
  Made by <a href="https://github.com/hendurhance">hendurhance</a> · <a href="https://www.pandia.app">pandia.app</a>
</p>
