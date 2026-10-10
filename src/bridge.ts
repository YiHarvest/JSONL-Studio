import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Edit, Info, Page, RecordData, SearchPage } from "./model";
import { parseTree } from "./model";

export const desktop = isTauri();
// Browser preview is intentionally limited to paste/import. Desktop disk reads
// always use Rust; no browser file API loads a user's complete file.
let preview: string[] = [];
let revision = 0;
function previewInfo(): Info {
  return {
    name: "Untitled.jsonl",
    path: null,
    size: new TextEncoder().encode(preview.join("\n")).length,
    totalLines: preview.length,
    modified: null,
    newline: "LF",
    encoding: "UTF-8",
    scratch: true,
    dirty: preview.length > 0 || revision > 0,
    revision,
  };
}
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
  revision = 0;
  return {
    name: "Untitled.jsonl",
    path: null,
    size: new TextEncoder().encode(normalized).length,
    totalLines: preview.length,
    modified: null,
    newline: text.includes("\r\n") ? "CRLF" : "LF",
    encoding: "UTF-8",
    scratch: true,
    dirty: preview.length > 0,
    revision,
  };
}
export async function editRecord(edit: Edit, expected: number): Promise<Info> {
  if (desktop) return invoke("edit_record", { edit, revision: expected });
  if (expected !== revision) throw new Error("Document changed");
  const index = edit.line - 1;
  if ("text" in edit) {
    JSON.parse(edit.text);
    const raw = compactJson(edit.text);
    if (edit.kind === "insert") preview.splice(index, 0, raw);
    else preview[index] = raw;
  } else if (edit.kind === "delete") preview.splice(index, 1);
  else preview.splice(index + 1, 0, preview[index]);
  revision++;
  return previewInfo();
}
function compactJson(text: string): string {
  let quoted = false,
    escaped = false,
    result = "";
  for (const char of text.trim()) {
    if (quoted) {
      result += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') {
      quoted = true;
      result += char;
    } else if (!/\s/.test(char)) result += char;
  }
  return result;
}
export async function searchDocument(
  query: string,
  mode: string,
  start: number,
): Promise<SearchPage> {
  if (desktop) return invoke("search_document", { query, mode, start });
  const hits: SearchPage["hits"] = [];
  const needle = query.toLowerCase();
  const end = Math.min(start + 2000, preview.length + 1);
  for (let line = start; line < end; line++) {
    const raw = preview[line - 1];
    if (mode === "raw") {
      if (raw.toLowerCase().includes(needle))
        hits.push({ line, pointer: "", preview: raw.slice(0, 160) });
    } else {
      try {
        const tree = parseTree(raw);
        const visit = (node: typeof tree, path: string) => {
          node.children?.forEach(({ key, node: child }) => {
            const next = `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
            if (
              mode === "key" &&
              node.type === "object" &&
              key.toLowerCase().includes(needle)
            )
              hits.push({ line, pointer: next, preview: key });
            visit(child, next);
          });
          if (!node.children && mode === "value") {
            const value =
              node.type === "string"
                ? (JSON.parse(node.text) as string)
                : node.text;
            if (value.toLowerCase().includes(needle))
              hits.push({ line, pointer: path, preview: value.slice(0, 160) });
          }
        };
        visit(tree, "");
      } catch {
        /* malformed lines only match raw */
      }
    }
    if (hits.length >= 100)
      return { hits, nextLine: line + 1, hasMore: line < preview.length };
  }
  return { hits, nextLine: end, hasMore: end <= preview.length };
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
