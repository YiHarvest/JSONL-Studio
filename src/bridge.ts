import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  DraftIssue,
  Edit,
  Info,
  Page,
  RecordData,
  SearchPage,
  TreeNodeSummary,
  TreePage,
} from "./model";
import { parseTree } from "./model";

export const desktop = isTauri();
const MAX_RECORD_PREVIEW = 2 * 1024 * 1024;
export const MAX_WEB_FILE = 8 * 1024 * 1024;
// Desktop disk reads always use Rust. Browser sessions have a separate cap.
let preview: string[] = [];
let revision = 0;
const scratchMetadata = {
  name: "Untitled.jsonl",
  format: "jsonl",
  modified: null,
  newline: "LF",
  encoding: "UTF-8",
  scratch: true,
} as const;
let metadata: Pick<Info, keyof typeof scratchMetadata> = scratchMetadata;
const encoder = new TextEncoder();

function sourceAt(index: number): string {
  const source = preview[index];
  return metadata.format === "jsonl" &&
    index < preview.length - 1 &&
    !source.endsWith("\n")
    ? source + (metadata.newline === "CRLF" ? "\r\n" : "\n")
    : source;
}
function rawRecord(source: string, line: number): string {
  return (line === 1 ? source.replace(/^\uFEFF/, "") : source).replace(
    /\r?\n$|\r$/,
    "",
  );
}
function physicalLines(source: string): string[] {
  return source.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}
function previewInfo(): Info {
  return {
    ...metadata,
    path: null,
    size: preview.reduce(
      (size, _, index) => size + encoder.encode(sourceAt(index)).length,
      0,
    ),
    totalLines: preview.length,
    dirty: (metadata.scratch && preview.length > 0) || revision > 0,
    revision,
  };
}
export async function openBrowserFile(file: File): Promise<Info> {
  if (desktop) throw new Error("Use the native file picker");
  if (file.size > MAX_WEB_FILE) throw new Error("File exceeds 8 MiB");
  const extension = file.name
    .match(/\.(json|jsonl|ndjson)$/i)?.[1]
    .toLowerCase();
  if (!extension) throw new Error("Choose a .json, .jsonl or .ndjson file");
  const format = extension === "json" ? "json" : "jsonl";
  const source = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(await file.arrayBuffer());
  const crlf = source.includes("\r\n");
  const lf = /(^|[^\r])\n/.test(source);
  metadata = {
    name: file.name,
    format,
    modified: file.lastModified / 1000,
    newline: crlf ? (lf ? "Mixed" : "CRLF") : "LF",
    encoding: source.startsWith("\uFEFF") ? "UTF-8 BOM" : "UTF-8",
    scratch: false,
  };
  preview = format === "json" ? [source] : physicalLines(source);
  revision = 0;
  return { ...previewInfo(), size: file.size };
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
  metadata = {
    ...scratchMetadata,
    newline: text.includes("\r\n") ? "CRLF" : "LF",
  };
  preview = physicalLines(normalized);
  revision = 0;
  return previewInfo();
}
export async function validateDraft(text: string): Promise<DraftIssue | null> {
  if (desktop) return invoke("validate_draft", { text });
  if (text === "") return null;
  const clean = text.replace(/^\uFEFF/, "").trim();
  try {
    JSON.parse(clean);
    return null;
  } catch {
    /* A JSONL document is validated one physical line at a time below. */
  }
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  if (!lines.length) lines.push("");
  for (let index = 0; index < lines.length; index++) {
    let source = lines[index].replace(/\r$/, "");
    if (index === 0) source = source.replace(/^\uFEFF/, "");
    try {
      JSON.parse(source);
    } catch (error) {
      const message = String(error);
      const explicit = /line \d+ column (\d+)/i.exec(message)?.[1];
      const position = /position (\d+)/i.exec(message)?.[1];
      return {
        line: index + 1,
        column: explicit
          ? Number(explicit)
          : position
            ? Number(position) + 1
            : 1,
      };
    }
  }
  return null;
}
export async function editRecord(edit: Edit, expected: number): Promise<Info> {
  if (desktop) return invoke("edit_record", { edit, revision: expected });
  if (expected !== revision) throw new Error("Document changed");
  if (
    metadata.format === "json" &&
    (edit.kind !== "replace" || edit.line !== 1)
  )
    throw new Error("A JSON file must contain exactly one root value");
  const index = edit.line - 1;
  if ("text" in edit) {
    JSON.parse(edit.text);
    const raw =
      metadata.format === "json"
        ? (metadata.encoding === "UTF-8 BOM" ? "\uFEFF" : "") + edit.text
        : compactJson(edit.text);
    if (edit.kind === "insert") preview.splice(index, 0, raw);
    else preview[index] = raw;
  } else if (edit.kind === "delete") preview.splice(index, 1);
  else
    preview.splice(
      index + 1,
      0,
      index === 0 ? preview[index].replace(/^\uFEFF/, "") : preview[index],
    );
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
    const raw = rawRecord(preview[line - 1], line);
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
    .map((_, index): RecordData => {
      const line = start + index;
      const complete = sourceAt(line - 1);
      const bytes = encoder.encode(complete);
      const truncated = bytes.length > MAX_RECORD_PREVIEW;
      const source = truncated
        ? new TextDecoder().decode(bytes.slice(0, MAX_RECORD_PREVIEW))
        : complete;
      const raw = rawRecord(source, line);
      if (truncated)
        return {
          line: start + index,
          raw,
          source,
          json: null,
          error: null,
          column: null,
          truncated: true,
        };
      try {
        JSON.parse(raw);
        return {
          line: start + index,
          raw,
          source,
          json: raw,
          error: null,
          column: null,
          truncated: false,
        };
      } catch (e) {
        return {
          line: start + index,
          raw,
          source,
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
  for (let index = 0; index < preview.length; index++) {
    try {
      JSON.parse(rawRecord(preview[index], index + 1));
      valid++;
    } catch {
      /* count below */
    }
  }
  return [valid, preview.length - valid];
}
export async function readTreeNode(
  line: number,
  route: number[],
  offset: number,
  limit = 50,
): Promise<TreePage> {
  if (desktop) return invoke("read_tree_node", { line, route, offset, limit });
  let node = parseTree(rawRecord(preview[line - 1], line));
  for (const index of route) {
    const child = node.children?.[index];
    if (!child) throw new Error("Tree path not found");
    node = child.node;
  }
  const children = node.children ?? [];
  return {
    node: summarizeNode(node),
    children: children.slice(offset, offset + limit).map((child, index) => ({
      index: offset + index,
      key: child.key,
      node: summarizeNode(child.node),
    })),
    offset,
    totalChildren: children.length,
    hasMore: offset + limit < children.length,
  };
}
function summarizeNode(node: ReturnType<typeof parseTree>): TreeNodeSummary {
  const encoded = node.children ? null : new TextEncoder().encode(node.text);
  return {
    kind: node.type,
    text: node.children
      ? node.type === "object"
        ? "{"
        : "["
      : new TextDecoder().decode(encoded!.slice(0, 500)),
    childCount: node.children?.length ?? null,
    truncated: encoded !== null && encoded.length > 500,
  };
}
