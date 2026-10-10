# JSONL Studio

A local desktop reader for JSONL and NDJSON. Built with **Tauri 2, Rust, React and TypeScript** for macOS Apple Silicon and Arch Linux. MIT licensed.

本地 JSONL / NDJSON 阅读器，一行一条记录，数据不上传服务器。

## Current milestone: M0 + M1 + M2

- Native file chooser, drag and drop, command line paths and macOS file activation.
- Indexed disk reads with bounded IPC pages, independent error handling per physical line.
- Virtualized record cards and JSON trees, per-node folding, Alt/Option recursive folding, depth controls and batches of 50 children.
- Tree, Pretty, wrapped raw, single-line raw and original source range.
- New session, paste JSON/JSONL, convert a JSON array to individual records.
- Chinese/English, system language, light/dark/system themes.
- Visible-range find, explicit full-file validation, external file change detection.
- Large integer spellings preserved in Tree and Pretty.

M1 was approved and M2 adds CodeMirror record editing, insert/duplicate/delete, raw/key/value whole-file search, atomic Save/Save As and local recovery checkpoints. Cmd/Ctrl+S saves; Shift+Cmd/Ctrl+S opens Save As. Performance figures are targets until measured end to end; see [validation](docs/validation.md) and [M2 contracts](docs/m2.md).

## Develop

Requires Node.js 22.12+ (CI uses Node 24), Rust stable and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/).

Arch Linux prerequisites:

```fish
sudo pacman -S --needed base-devel rust nodejs npm webkit2gtk-4.1 gtk3 librsvg patchelf
npm ci
npm run tauri dev
```

macOS:

```sh
xcode-select --install
npm ci
npm run tauri dev
```

To open a file from the terminal:

```fish
npm run tauri dev -- /absolute/path/file.jsonl
# Installed app:
jsonl-studio /absolute/path/file.jsonl
```

`npm run dev` offers a browser preview with paste and sample data. Disk files use Rust in the desktop app.

## Checks

```fish
npm run lint
npm run format:check
npm test
npm run build
npx playwright install chromium
npm run test:e2e
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

Headless core checks: `cargo test --manifest-path src-tauri/Cargo.toml --no-default-features`.

## Documents

- [Product scope and milestones](docs/product.md)
- [Architecture and data contracts](docs/architecture.md)
- [Tree interaction](docs/tree-interaction.md)
- [Validation and benchmarks](docs/validation.md)
- [Packaging and release](docs/release.md)
- [Contributing](CONTRIBUTING.md)

Working branch: `dev`. PRs run checks. `v*` tags build macOS/Linux artifacts with SHA256 checksums. Public macOS distribution requires Developer ID signing and notarization credentials.
