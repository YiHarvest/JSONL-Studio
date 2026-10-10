# Security

JSONL Studio processes documents locally. It contains no telemetry or upload feature. M1 reads disk files and creates bounded session-only imports; it does not write source files.

Supported security fixes target the latest release and `dev`.

Report security issues privately using [GitHub private vulnerability reporting](https://github.com/YiHarvest/JSONL-Studio/security/advisories/new). Do not attach confidential datasets; provide a minimal synthetic reproducer.

Record and IPC limits protect the UI from unbounded data transfers. Invalid encoding and oversized records are surfaced as isolated preview errors. Dependencies and Tauri capabilities should be reviewed when adding future editing, update or plugin features.
