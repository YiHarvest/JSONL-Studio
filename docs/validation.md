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
