# Contributing

Work on `dev` or a feature branch based on it. Use Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `ci:`). Keep changes scoped and runnable.

Use strict TypeScript, explicit IPC contracts and Rust-owned file content. Components must not load complete disk files. Never log document content, paths or clipboard data for telemetry.

Before a PR run the commands in README: frontend lint/format/test/build, Playwright, Rust fmt/clippy/test. Include behavior changes, relevant validation and platform limits in the PR description.

New file semantics must have Rust regression tests; frontend tests should verify user-visible behavior. Performance claims require reproducible benchmark inputs and measured results. Do not commit generated large datasets, binaries, target directories or signing credentials.

M1 was accepted and M2 is authorized. Release tags require platform qualification; a passing browser test does not prove native Finder/file association behavior.
