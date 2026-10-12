import {
  readFileSync,
  readdirSync,
  copyFileSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

async function digest(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

const [command, argument, destination] = process.argv.slice(2);
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const tauri = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const cargo = readFileSync("src-tauri/Cargo.toml", "utf8").match(
  /^version = "([^"]+)"/m,
)?.[1];
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const cargoLock = readFileSync("src-tauri/Cargo.lock", "utf8").match(
  /\[\[package\]\]\s+name = "jsonl-studio"\s+version = "([^"]+)"/,
)?.[1];
if (
  ![
    tauri.version,
    cargo,
    cargoLock,
    lock.version,
    lock.packages[""].version,
  ].every((v) => v === pkg.version)
) {
  throw new Error(
    "Release versions do not match across package, lockfile, Cargo and Tauri",
  );
}
if (command === "version") {
  if (argument && argument !== `v${pkg.version}`)
    throw new Error(`Tag must be v${pkg.version}`);
  console.log(pkg.version);
} else if (command === "collect") {
  const root = argument;
  const platform = destination;
  if (!["linux-x86_64", "macos-aarch64"].includes(platform))
    throw new Error("Unknown platform");
  const suffix = platform.startsWith("linux") ? ".AppImage" : ".dmg";
  const files = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(suffix)) files.push(path);
    }
  }
  walk(root);
  if (files.length !== 1)
    throw new Error(`Expected one ${suffix}, found ${files.length}`);
  mkdirSync("release-artifacts", { recursive: true });
  const name = `JSONL-Studio_${pkg.version}_${platform}${suffix}`;
  copyFileSync(files[0], join("release-artifacts", name));
  const checksum = await digest(files[0]);
  writeFileSync(
    join("release-artifacts", `SHA256SUMS-${platform}`),
    `${checksum}  ${name}\n`,
  );
  console.log(name);
} else if (command === "verify") {
  const root = argument;
  const sums = readdirSync(root).filter((name) =>
    name.startsWith("SHA256SUMS-"),
  );
  const entries = sums.flatMap((name) =>
    readFileSync(join(root, name), "utf8").trim().split("\n"),
  );
  if (!entries.length) throw new Error("No checksums");
  const names = new Set();
  const allowed = new Set([
    `JSONL-Studio_${pkg.version}_linux-x86_64.AppImage`,
    `JSONL-Studio_${pkg.version}_macos-aarch64.dmg`,
  ]);
  for (const entry of entries) {
    const match = /^([a-f0-9]{64}) {2}(JSONL-Studio_[^\s/]+)$/.exec(entry);
    if (!match || names.has(match[2]))
      throw new Error("Invalid or duplicate checksum entry");
    if (!allowed.has(match[2]) || basename(match[2]) !== match[2])
      throw new Error(`Unexpected installer: ${match[2]}`);
    names.add(match[2]);
    const actual = await digest(join(root, match[2]));
    if (actual !== match[1]) throw new Error(`Checksum mismatch: ${match[2]}`);
  }
  if (!names.has(`JSONL-Studio_${pkg.version}_linux-x86_64.AppImage`))
    throw new Error("Linux AppImage missing");
  const installers = readdirSync(root).filter((name) =>
    /\.(AppImage|dmg)$/.test(name),
  );
  if (installers.some((name) => !names.has(name)))
    throw new Error("Installer missing from checksums");
  writeFileSync(join(root, "SHA256SUMS"), entries.sort().join("\n") + "\n");
  console.log(`Verified ${entries.length} installers`);
} else
  throw new Error(
    "Use version [tag], collect <bundle-root> <platform>, or verify <artifact-dir>",
  );
