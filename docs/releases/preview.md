## JSONL Studio preview / 预览版

Local JSONL/NDJSON reader and editor. No Node.js or Rust installation is needed.

本地 JSONL/NDJSON 阅读与编辑工具，无需安装 Node.js 或 Rust。

### Download / 下载

- Linux x86_64: download `JSONL-Studio_*_linux-x86_64.AppImage`, make it executable, and launch it. Arch Linux is the initial Linux target.
- macOS Apple Silicon: a signed/notarized `.dmg` is included only when Apple signing credentials and verification pass. Drag the app into Applications.
- `SHA256SUMS` checks the installer downloads.

### Included / 功能

Tree/Pretty/Raw/original views, direct new-file JSON/array/JSONL editing with clipboard actions, collapsible file/search sidebars, compact icon-only language/theme controls, persistent content font scaling, independent invalid-line handling, range navigation, inline CodeMirror record editing, insert/duplicate/delete, live whole-file raw/key/value search with highlighted matches, atomic Save/Save As and local recovery.

树形与原文阅读、新建文件直接编辑 JSON/数组/JSONL 与草稿复制粘贴、可折叠文件/搜索侧栏、精简的语言/主题图标控件、内容字号缩放、坏行隔离、分页跳转、记录原位编辑和增删复制、实时全文件搜索与命中高亮、安全保存、另存为和本地恢复。

### Preview limits / 预览限制

- Record editing: 2 MiB per record; paste: 8 MiB; edit buffer: 32 MiB; search results: up to 500.
- Recovery of disk edits requires the original file to remain unchanged. Unapplied editor drafts are not checkpointed.
- 1 GiB performance, complete GPU/desktop qualification, GNOME/KDE associations and macOS Finder interactions are not fully certified.
- Linux AppImage may need FUSE 2. On Arch: `sudo pacman -S fuse2`. If FUSE is unavailable, run with `--appimage-extract-and-run`.
- A blank Linux window may be a WebKit graphics issue. Try `env WEBKIT_DISABLE_DMABUF_RENDERER=1 LIBGL_ALWAYS_SOFTWARE=1 ./JSONL-Studio_*_linux-x86_64.AppImage`.

这是预览版；超大文件性能、完整平台交互仍在验证。请通过 GitHub Issues 提交系统版本、复现步骤和不含敏感信息的最小样例。
