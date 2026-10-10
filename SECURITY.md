# Security

JSONL Studio processes documents locally. It contains no telemetry or upload feature. M2 writes only user-selected JSONL/NDJSON destinations and a local recovery checkpoint. Save streams into a temporary file before atomic replacement; recovery contains sensitive document edits and remains in the user's local application-data directory.

Supported security fixes target the latest release and `dev`.

Report security issues privately using [GitHub private vulnerability reporting](https://github.com/YiHarvest/JSONL-Studio/security/advisories/new). Do not attach confidential datasets; provide a minimal synthetic reproducer.

Record and IPC limits protect the UI from unbounded data transfers. Invalid encoding and oversized records are surfaced as isolated preview errors. Dependencies and Tauri capabilities should be reviewed when adding future editing, update or plugin features.
