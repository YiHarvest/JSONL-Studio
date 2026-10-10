# Engineering conventions

- Current authorized scope: M0 + M1 + M2. User approved continuation after reviewing M1.
- Rust is the only source of truth for desktop document contents.
- Keep IPC and rendering bounded. All-mode must not load a complete file into JavaScript.
- Preserve numeric source tokens and physical line identity.
- Use native OS file activation paths and native macOS window buttons.
- Run Rust fmt/clippy/test and frontend lint/format/test/build. Validate UI through Playwright.
- Use Conventional Commits. Working remote is `https://github.com/YiHarvest/JSONL-Studio`, branch `dev`.
- All data stays local. Do not add telemetry, remote fonts or cloud storage.
- Track actual checks and platform limitations in `docs/validation.md`.
