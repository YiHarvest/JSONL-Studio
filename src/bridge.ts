import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Info, Page, RecordData } from "./model";
import { parseTree } from "./model";

export const desktop = isTauri();
// Browser preview is intentionally limited to paste/import. Desktop disk reads
// always use Rust; no browser file API loads a user's complete file.
let preview: string[] = [];
export async function importText(text: string): Promise<Info> {
  if (desktop) return invoke("import_text", { text });
  if (new TextEncoder().encode(text).length > 8 * 1024 ** 2)
    throw new Error("Paste is limited to 8 MiB");
  let normalized = text;
  try {
    JSON.parse(text);
    const node = parseTree(text.trim());
    normalized =
      node.type === "array"
        ? node.children!.map((item) => item.node.text).join("\n")
        : node.text;
  } catch {
    /* Independent line parsing below. */
  }
  preview = normalized ? normalized.replace(/\r?\n$/, "").split("\n") : [];
  return {
    name: "Untitled.jsonl",
    path: null,
    size: new TextEncoder().encode(normalized).length,
    totalLines: preview.length,
    modified: null,
    newline: text.includes("\r\n") ? "CRLF" : "LF",
    encoding: "UTF-8",
    scratch: true,
  };
}
export async function readPage(start: number, count: number): Promise<Page> {
  if (desktop) return invoke("read_page", { start, count });
  const records = preview
    .slice(start - 1, start - 1 + count)
    .map((raw, index): RecordData => {
      try {
        JSON.parse(raw);
        return {
          line: start + index,
          raw,
          source: raw + (start + index < preview.length ? "\n" : ""),
          json: raw,
          error: null,
          column: null,
          truncated: false,
        };
      } catch (e) {
        return {
          line: start + index,
          raw,
          source: raw + (start + index < preview.length ? "\n" : ""),
          json: null,
          error: String(e),
          column: null,
          truncated: false,
        };
      }
    });
  const nextLine = start + records.length;
  return { records, nextLine, hasMore: nextLine <= preview.length };
}
export async function validateFile(): Promise<[number, number]> {
  if (desktop) return invoke("validate_file");
  let valid = 0;
  for (const raw of preview) {
    try {
      JSON.parse(raw);
      valid++;
    } catch {
      /* count below */
    }
  }
  return [valid, preview.length - valid];
}
