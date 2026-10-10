# Preview package validation

Version: `0.1.0-beta.1`. Local platform: Arch Linux x86_64, GTK 3.24.52/WebKitGTK 2.54.1.

## Passed

- Production AppImage built with Tauri 2; approximately 104 MiB.
- `default-run = "jsonl-studio"` and `mainBinaryName = "jsonl-studio"` select the GUI rather than the separate benchmark.
- The extracted AppImage launched without a Vite development server.
- A UTF-8 filename containing Chinese and a space opened through CLI, with two records and exact `9007199254740993` displayed.
- A second process exited successfully and forwarded the path to the existing GUI.
- Xvfb with software rendering displayed the complete window.
- Version/tag consistency and SHA-256 checks passed.
- Wrong-tag validation failed as expected.
- Rust core filesystem tests: 16 passed. Frontend Vitest: 4 passed. Lint and formatting passed.
- GitHub Actions workflow passed actionlint.

## Coverage limits

The native package smoke test covers startup, CLI file opening and repeated launch. Rust tests verify edit/save/recovery contents and conflicts; browser Playwright verifies interactive editing. This does not claim a fully automated native-dialog/save UI test.

GNOME/KDE installation and desktop MIME registration remain platform qualification tasks. AppImage is not a native system package. macOS DMG is built on PR CI for review; public DMG publication requires signing/notarization credentials, which are not configured at preparation time.

The first build exposed Tauri's selection of the benchmark binary; it was discarded and rebuilt from corrected configuration. Only the validated GUI AppImage is a delivery candidate.
