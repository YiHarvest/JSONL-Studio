export interface Info {
  name: string;
  path: string | null;
  size: number;
  totalLines: number;
  modified: number | null;
  newline: string;
  encoding: string;
  scratch: boolean;
  dirty: boolean;
  revision: number;
}
export interface DraftIssue {
  line: number;
  column: number;
}
export type Edit =
  | { kind: "replace" | "insert"; line: number; text: string }
  | { kind: "delete" | "duplicate"; line: number };
export interface SearchHit {
  line: number;
  pointer: string;
  preview: string;
}
export interface SearchPage {
  hits: SearchHit[];
  nextLine: number;
  hasMore: boolean;
}
export interface RecordData {
  line: number;
  raw: string;
  source: string;
  json: string | null;
  error: string | null;
  column: number | null;
  truncated: boolean;
}
export interface Page {
  records: RecordData[];
  nextLine: number;
  hasMore: boolean;
}
export interface TreeNodeSummary {
  kind: JsonNode["type"];
  text: string;
  childCount: number | null;
  truncated: boolean;
}
export interface TreeChild {
  index: number;
  key: string;
  node: TreeNodeSummary;
}
export interface TreePage {
  node: TreeNodeSummary;
  children: TreeChild[];
  offset: number;
  totalChildren: number;
  hasMore: boolean;
}
export type ViewMode = "tree" | "pretty" | "wrap" | "raw" | "source";

// JSON.parse loses precision for large integers. This tokenizer retains every
// primitive's source spelling and builds only the bounded, visible record.
export interface JsonNode {
  type: "object" | "array" | "string" | "number" | "boolean" | "null";
  text: string;
  children?: { key: string; node: JsonNode }[];
}
export function parseTree(text: string): JsonNode {
  let at = 0;
  const whitespace = () => {
    while (/\s/.test(text[at] ?? "") && at < text.length) at++;
  };
  const string = () => {
    const begin = at++;
    while (at < text.length) {
      const char = text[at++];
      if (char === "\\") at++;
      else if (char === '"') return text.slice(begin, at);
    }
    throw new Error("Unterminated string");
  };
  const value = (depth: number): JsonNode => {
    if (depth > 128) throw new Error("Tree depth exceeds 128");
    whitespace();
    const start = at;
    const char = text[at];
    if (char === "{" || char === "[") {
      at++;
      const children: NonNullable<JsonNode["children"]> = [];
      const end = char === "{" ? "}" : "]";
      whitespace();
      while (text[at] !== end) {
        if (at >= text.length) throw new Error("Unterminated container");
        const key =
          char === "{"
            ? (JSON.parse(string()) as string)
            : String(children.length);
        whitespace();
        if (char === "{" && text[at++] !== ":")
          throw new Error("Expected colon");
        children.push({ key, node: value(depth + 1) });
        whitespace();
        if (text[at] === ",") {
          at++;
          whitespace();
        } else if (text[at] !== end) throw new Error("Expected comma");
      }
      at++;
      return {
        type: char === "{" ? "object" : "array",
        text: text.slice(start, at),
        children,
      };
    }
    if (char === '"') return { type: "string", text: string() };
    while (at < text.length && !/[\s,\]}]/.test(text[at])) at++;
    const raw = text.slice(start, at);
    if (!raw) throw new Error("Expected value");
    const type =
      raw === "null"
        ? "null"
        : raw === "true" || raw === "false"
          ? "boolean"
          : "number";
    return { type, text: raw };
  };
  const result = value(0);
  whitespace();
  if (at !== text.length) throw new Error("Trailing content");
  return result;
}
export function pretty(node: JsonNode, depth = 0): string {
  if (!node.children) return node.text;
  const [open, close] = node.type === "object" ? ["{", "}"] : ["[", "]"];
  if (!node.children.length) return open + close;
  return `${open}\n${node.children
    .map(
      ({ key, node: child }) =>
        `${"  ".repeat(depth + 1)}${node.type === "object" ? `${JSON.stringify(key)}: ` : ""}${pretty(child, depth + 1)}`,
    )
    .join(",\n")}\n${"  ".repeat(depth)}${close}`;
}
export function pointer(parent: string, key: string): string {
  return `${parent}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
}
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return bytes < 1024 ** 2
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
