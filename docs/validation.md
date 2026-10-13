# Validation record

## Local environment

Arch Linux x86_64, AMD Ryzen 5 4600H (6 cores / 12 threads), approximately 15 GiB RAM. Node 26.10.0, Rust 1.96.0, GTK 3.24.52, WebKitGTK 2.54.1. Existing desktop workloads and Rust compilation were active during the benchmark run.

## Checks

- Frontend lint, strict TypeScript and production build passed.
- Vitest: 4 tests passed (lossless numbers/strings, nested tree, pointer escaping, depth guard, matching locale keys).
- Playwright Chromium: 3 scenarios passed (reading/errors/views/navigation, array import/lazy tree/preferences, recursive folding/copy).
- Full Rust test run: 7 core tests passed, including source-preservation regression.
- Desktop `cargo check` and all-target clippy with `-D warnings` passed.
- npm audit after upgrading Vitest: zero reported vulnerabilities.
- Linux debug desktop executable built successfully and launched under Xvfb. The Chinese/system-dark welcome screen rendered in WebKitGTK.
- CLI activation of the real 100 MiB file rendered 100 tree records and the correct 93,633-line index in WebKitGTK.
- Benchmark generator passed ruff and black checks. Prettier formatting check passed.

## M2 checks

- Save now reuses the already validated temporary-file index after atomic rename, instead of rescanning the saved file and retaining two new index allocations. Metadata changes after rename are rejected. The index-allocation reuse regression passes; Rust core tests total 17.

- M2 frontend lint, strict TypeScript and production build passed; CodeMirror is a separate lazy-loaded chunk.
- Playwright: all 4 scenarios passed, including invalid edit rejection, large-integer editing, duplicate/delete/add and full-document search with pointer expansion.
- Rust: 16 tests cover baseline reading plus edit sequencing, source and destination conflict refusal, failed writes, recovery roundtrip, stale revisions, invalid bytes, BOM insertion and Unix permissions/symlink protection.
- Full desktop build and clippy checks run on local Arch Linux. Browser tests use bounded preview inputs; disk saving and recovery correctness are verified by Rust filesystem tests.
- Embedded-resource desktop build passed. Initial Xvfb snapshots were incomplete with DRI3 warnings; enabling `WEBKIT_DISABLE_DMABUF_RENDERER=1` and `LIBGL_ALWAYS_SOFTWARE=1` rendered the full Chinese/system-dark M2 window successfully. This verifies software rendering, not GPU performance.
- Recovery requires the original disk source to remain available and unchanged. Unapplied CodeMirror drafts are not checkpointed.
- M1 performance measurements below remain unchanged; M2 does not certify the existing latency, FPS or full-app memory targets.

## Reader workspace and search checks

- The reader workspace keeps file metadata in a collapsible left sidebar and full-file search results in a collapsible right sidebar. At a 2,708 × 1,640 viewport with both sidebars open, the center editor measured 2,162 px wide and the document had no horizontal overflow.
- The second toolbar was removed. Open/new/save commands and whole-file search share the 52 px native titlebar row; view modes, add-record and tree-depth controls live in the collapsible left navigator.
- The separate paste command was removed. New opens a bounded 8 MiB inline document draft that accepts JSON, JSON arrays or JSONL, supports native clipboard editing plus Copy all, and hands applied content to the Rust document.
- Record editing uses an inline CodeMirror instance inside the selected record card. Adding a record from a one-record page navigates directly to the inserted physical line; the document remains dirty until the explicit Save command writes it to disk.
- At a 900 × 700 viewport, sidebars switch to overlays, the center editor retains the full 900 px layout width, and the single-row titlebar does not overflow.
- Search starts after a 250 ms input debounce, scans the Rust-backed document in bounded batches, preserves all visible records, and highlights every visible case-insensitive match in Tree, Pretty, Raw, source and result-preview surfaces. Rendering is capped at 1,000 highlights per text surface.
- Content font scaling supports 80–180%, persists locally, updates virtual tree row measurements, and exposes `Cmd/Ctrl +`, `Cmd/Ctrl -` and `Cmd/Ctrl 0`.
- Frontend strict TypeScript, ESLint, Prettier, Vitest (5 tests), production build and Playwright Chromium (5 scenarios) passed. Playwright covers automatic full-file search, result navigation, visible yellow highlights and font scaling.
- Rust fmt, all-target/all-feature clippy with `-D warnings`, and all 17 Rust tests passed. No Rust document-content or IPC contract changed in this UI module.

## Reproduce benchmarks

```fish
python benchmarks/generate.py benchmarks/data/100m.jsonl --mib 100
python benchmarks/generate.py benchmarks/data/1g.jsonl --mib 1024
cargo build --release --manifest-path src-tauri/Cargo.toml --no-default-features --bin benchmark
src-tauri/target/release/benchmark benchmarks/data/100m.jsonl 20
src-tauri/target/release/benchmark benchmarks/data/1g.jsonl 20
```

Inputs contain deterministic objects with 1,024-character payloads, metadata and score arrays. Actual size exceeds the selected MiB threshold by at most one record.

| Input                 | Core index + first 100 records, p95 | Min       | Max          | Result                             |
| --------------------- | ----------------------------------- | --------- | ------------ | ---------------------------------- |
| 100 MiB, 93,633 lines | 22.41 ms                            | 12.06 ms  | 3,083.97 ms  | Completed 20 runs                  |
| 1 GiB                 | 22,168.66 ms                        | 118.67 ms | 34,708.03 ms | Completed 20 runs without crashing |

These measurements include mixed cache behavior and competing system workloads. The executable's original “warm cache” label is too strong: no cache control was applied. The first run and all outliers are retained in the sample arrays; p95 is the nearest-rank statistic.

**The <2-second interaction, <300 MB full-app memory and 50–60 FPS targets are not certified by this run.** Core benchmarks exclude WebView startup/rendering. The 1 GiB tail latency needs isolated end-to-end measurement and incremental indexing investigation. No cold-cache cache-dropping command was run.

## Platform coverage

Browser tests verify React interaction, not native OS activation. macOS signing/notarization, Finder double-click while closed/running, and native traffic lights require a macOS runner/device. GNOME and KDE file association qualification and AppImage installation are M3 platform checks. The workflows build those platform targets, but local checks do not imply CI has already run.
