# Preview package delivery

The preview version is `0.1.0-beta.3`. Feature changes arrive through module PRs targeting `dev`; the maintainer merges manually. GitHub automatically deletes merged feature branches.

## Before merge

The installer workflow runs on release-related PRs. It builds Linux AppImage and an unsigned macOS Apple Silicon DMG for validation. PR runs upload Actions artifacts only; they never create a public Release and do not expose signing secrets.

Review frontend/Rust CI and installer jobs. Download the artifacts and test native dialogs, editing/saving, external conflicts, recovery, file activation, filenames with spaces and non-ASCII, and repeated launch. A smoke test proves that the packaged process stays running, not that every native interaction is qualified.

## After the maintainer merges

Confirm all three module PRs have been merged and `dev` checks pass. Only tag the merged commit:

```fish
git switch dev
git pull --ff-only origin dev
node scripts/release.mjs version v0.1.0-beta.3
git tag -a v0.1.0-beta.3 -m "JSONL Studio preview"
git push origin v0.1.0-beta.3
```

The tag workflow builds installers, validates the tag against package/Tauri/Cargo/lock versions, checks SHA-256 and creates a GitHub prerelease with the installers and combined `SHA256SUMS`. No unmerged branch is tagged by the agent.

`workflow_dispatch` builds review artifacts without publication. This supports testing the merged release code before creating a tag.

## Linux

```fish
npm ci
npm run tauri build -- --bundles appimage
node scripts/release.mjs collect src-tauri/target/release/bundle linux-x86_64
node scripts/release.mjs verify release-artifacts
```

Tauri explicitly uses `mainBinaryName: jsonl-studio`; the separate benchmark executable must never be packaged as the app.

Stable asset name: `JSONL-Studio_0.1.0-beta.3_linux-x86_64.AppImage`. Download, allow execution and launch. FUSE 2 may be required; extraction mode works without it. Arch `PKGBUILD` references the prerelease tag and is a source-package template, not a submitted AUR package. AppImage does not automatically install MIME or application-menu integration.

CI builds on Ubuntu 24.04 and launches the extracted AppImage executable under Xvfb without a development server. Test separately on Arch/GNOME/KDE before broad stable distribution.

## macOS signing gate

Public macOS publication is paused by default. It requires explicitly setting repository variable `MACOS_PUBLIC_RELEASE_ENABLED=true` and all six repository secrets:

`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`.

Without the opt-in variable the tag workflow publishes Linux only, even if credentials are later configured. PR builds produce unsigned DMG review artifacts with Apple signing variables removed from the process environment; empty certificate variables must not trigger a keychain import. With opt-in and credentials, Tauri signs and notarizes, then checks `codesign`, `spctl`, and Staple.

Initial target is Apple Silicon `aarch64-apple-darwin`. Intel/Universal is not included. Apple Developer enrollment, signing credentials and macOS device qualification require the maintainer's account/device; the agent cannot manufacture them.

## Checksums and notes

`scripts/release.mjs` rejects mismatched versions, wrong tags, missing/duplicate installers and checksum mismatches. It creates stable attachment names and combines platform checksums. Release notes are bilingual in `docs/releases/preview.md`.

Public release publication uses GitHub Releases, not Actions artifact links. Automatic application updates remain a later feature; this preview does not install an updater.
