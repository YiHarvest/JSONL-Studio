# Packaging and release

M1 delivery is the `dev` branch and a runnable development/build application. Public publishing is M3.

## Linux

Build AppImage using `npm run tauri build -- --bundles appimage`. Tauri generates the bundle desktop entry and file association. The Arch source package template installs a native executable, desktop entry, icon and MIME XML.

`PKGBUILD` references `v0.1.0`; that tag must exist before packaging from a release. Do not publish to AUR before testing `makepkg` against the release and validating desktop activation on GNOME and KDE/Plasma.

Test cold launch with a path, second launch forwarding, filenames with spaces/non-ASCII, drag/drop, file chooser, read-only files and external deletion/truncation.

## macOS

Initial build target: `aarch64-apple-darwin`, DMG. Bundled file associations route `.jsonl`/`.ndjson` to the app. Test Finder double-click/Open With while closed and already running, drag/drop, titlebar traffic lights, system theme, shortcuts and recent files.

GitHub Actions accepts Apple signing secrets. Missing credentials produce an unsigned development artifact; this is not a qualified public macOS release. Before public release, verify Developer ID, hardened runtime, notarization and Staple using `codesign`, `spctl`, `xcrun stapler validate` on the downloaded artifact.

## Automation

PR/push CI checks frontend and Rust on Linux/macOS. Tags matching `v*` build platform artifacts through `tauri-action`, generate SHA256SUMS and upload workflow artifacts.

GitHub Release publication and automatic updates are intentionally separate M3 steps. Do not tag or publish during M1 review. A future release job must verify package version matches tag, combine checksums and explicitly publish the verified artifacts.

The icon is a temporary locally generated braces mark; final name and icon remain product decisions.
