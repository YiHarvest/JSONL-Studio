# Product scope

JSONL Studio is a local desktop JSONL/NDJSON reader and future lightweight editor. Initial platforms are macOS Apple Silicon and Arch Linux. Data processing has no remote service, telemetry or network font dependency.

## Milestones

| Milestone | Scope                                                                                                           | Gate                               |
| --------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| M0        | Tauri shell, indexed Rust reads, nested tree                                                                    | Build and core tests               |
| M1        | File activation, range navigation, five views, tree interactions, paste/new/array conversion, languages, themes | User reviews runnable reader       |
| M2        | Record add/edit/copy/delete, whole-file raw/key/value search, hit expansion, safe save/Save As, recovery        | Begins only after user approves M1 |
| M3        | Signed/notarized macOS, AppImage/PKGBUILD, release and update mechanism                                         | Platform qualification             |
| P2        | JSONPath/JMESPath, field stats, schema inference, diff, table                                                   | Subsequent scope                   |

## Reading contract

- Line numbers are 1-based physical line numbers. Empty lines are invalid JSON records and retain their position.
- Empty files have zero records; a terminal newline does not add a phantom record.
- UTF-8 is supported; a first-line BOM is accepted. Invalid encoding is a per-line error. LF, CRLF and mixed line endings are recognized.
- A JSONL line may contain an object, array, string, number, boolean or null.
- Opening JSONL never interprets an array record as multiple lines. Explicit paste/import of a JSON array converts its elements into records.
- A single record may contain duplicate object keys; the tree preserves them. Duplicate-key folding shares the same JSON Pointer.
- Raw and Original do not reserialize records. Pretty retains original numeric tokens.
- Original displays the selected source range, including its newline spelling. Invalid UTF-8 is displayed with replacement characters; it is not a byte export.
- Every IPC page is capped at 1,000 lines and 8 MiB input bytes; record preview is capped at 2 MiB. Oversized lines are marked as unavailable previews, not silently parsed as full records.
- All/custom count is a browsing scope, not an instruction to transfer the entire file into JavaScript. Next continues at the actual returned line.
- Paste is capped at 8 MiB; larger inputs use disk opening.
- Valid/error counts initially describe the returned range. Explicit validation scans the file. Oversized previews count as errors under the reader limit.
- External changes trigger reload. Reads reject stale indexes. No save command exists in M1.
- Opening a new input prompts before replacing a non-empty unsaved scratch session.
- Only the latest requested file is opened when several OS activation paths arrive together; M1 has one active document.

## Desktop experience

Unified macOS titlebar with native traffic lights, native open dialog, keyboard shortcuts, compact toolbar and independent record cards. Linux uses the system's titlebar. Shortcuts: Cmd/Ctrl+O, N, F and G. Cmd/Ctrl+S arrives with M2.

Finder double-click and Open With use bundle file associations and macOS `RunEvent::Opened`; a second Linux process forwards paths to the existing instance. Recent-open UI remains a follow-up item for M3 platform polish.

## Performance targets

- 100 MB p95 interaction latency <2 seconds.
- 1 GB file opens without crashing.
- 50–60 FPS scrolling.
- Under 300 MB total application memory with a 1 GB file and 100 displayed records.

These require recorded hardware, input shape, cache condition and complete WebView process memory. Pathological files with millions of tiny lines and very wide/deep records must be tested separately.

## Decisions still open

Final name/icon, Intel/Universal macOS, AUR timing, Apple Developer membership and whether the first public release includes M2. No public release is implied by pushing `dev`.
