import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  cpSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const source = resolve("scripts/release.mjs");
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "jsonl-release-"));
  for (const file of [
    "package.json",
    "package-lock.json",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
    "src-tauri/tauri.conf.json",
  ]) {
    const target = join(dir, file);
    mkdirSync(join(target, ".."), { recursive: true });
    cpSync(file, target);
  }
  const run = (...args) =>
    spawnSync(process.execPath, [source, ...args], {
      cwd: dir,
      encoding: "utf8",
    });
  return {
    dir,
    run,
    clean: () => rmSync(dir, { recursive: true, force: true }),
  };
}
test("version gate rejects wrong tags and Cargo.lock drift", () => {
  const f = fixture();
  try {
    const version = JSON.parse(
      readFileSync(join(f.dir, "package.json")),
    ).version;
    assert.equal(f.run("version", `v${version}`).status, 0);
    assert.notEqual(f.run("version", "v99.0.0").status, 0);
    const lock = join(f.dir, "src-tauri/Cargo.lock");
    writeFileSync(
      lock,
      readFileSync(lock, "utf8").replace(
        /(name = "jsonl-studio"\s+version = ")[^"]+/,
        "$199.0.0",
      ),
    );
    assert.notEqual(f.run("version").status, 0);
  } finally {
    f.clean();
  }
});
test("installer gate detects tampering, unlisted files and wrong versions", () => {
  const f = fixture();
  try {
    mkdirSync(join(f.dir, "bundle"));
    writeFileSync(join(f.dir, "bundle/test.AppImage"), "synthetic installer");
    assert.equal(f.run("collect", "bundle", "linux-x86_64").status, 0);
    assert.equal(f.run("verify", "release-artifacts").status, 0);
    const version = JSON.parse(
      readFileSync(join(f.dir, "package.json")),
    ).version;
    const name = `JSONL-Studio_${version}_linux-x86_64.AppImage`;
    const root = join(f.dir, "release-artifacts");
    writeFileSync(join(root, name), "modified");
    assert.match(
      f.run("verify", "release-artifacts").stderr,
      /Checksum mismatch/,
    );
    const hash = createHash("sha256").update("modified").digest("hex");
    writeFileSync(join(root, "SHA256SUMS-linux-x86_64"), `${hash}  ${name}\n`);
    writeFileSync(join(root, "extra.dmg"), "extra");
    assert.match(
      f.run("verify", "release-artifacts").stderr,
      /missing from checksums/,
    );
    rmSync(join(root, "extra.dmg"));
    writeFileSync(
      join(root, "SHA256SUMS-linux-x86_64"),
      `${hash}  JSONL-Studio_99_linux-x86_64.AppImage\n`,
    );
    assert.match(
      f.run("verify", "release-artifacts").stderr,
      /Unexpected installer/,
    );
  } finally {
    f.clean();
  }
});
