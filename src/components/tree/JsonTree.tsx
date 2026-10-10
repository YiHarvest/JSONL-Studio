import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight, MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { pointer, type JsonNode } from "../../model";

export interface TreeState {
  open: Map<string, boolean>;
  limits: Map<string, number>;
  collapsed?: boolean;
  hit?: string;
}
interface Row {
  path: string;
  jsonPath: string;
  key: string;
  node: JsonNode;
  depth: number;
  more?: boolean;
}
export function JsonTree({
  root,
  state,
  defaultDepth,
  copy,
  edit,
  search,
}: {
  root: JsonNode;
  state: TreeState;
  defaultDepth: number;
  copy: (text: string) => void;
  edit: () => void;
  search: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [version, update] = useState(0);
  const [menu, setMenu] = useState<string | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const isOpen = (path: string, depth: number) =>
    state.open.get(path) ?? depth < defaultDepth;
  const rows = useMemo(() => {
    // Map mutations belong to this session; version invalidates the flattened view.
    void version;
    const result: Row[] = [];
    const visit = (
      node: JsonNode,
      key: string,
      path: string,
      jsonPath: string,
      depth: number,
    ) => {
      if (result.length >= 10000) return;
      result.push({ node, key, path, jsonPath, depth });
      if (!node.children || !(state.open.get(path) ?? depth < defaultDepth))
        return;
      let limit = state.limits.get(path) ?? 50;
      if (state.hit !== undefined) {
        const target = node.children.findIndex(({ key }) => {
          const child = pointer(path, key);
          return state.hit === child || state.hit?.startsWith(`${child}/`);
        });
        if (target >= limit)
          limit = Math.min(10000, Math.ceil((target + 1) / 50) * 50);
        state.limits.set(path, limit);
      }
      node.children.slice(0, limit).forEach(({ key, node: child }) => {
        visit(
          child,
          key,
          pointer(path, key),
          node.type === "array"
            ? `${jsonPath}[${key}]`
            : `${jsonPath}[${JSON.stringify(key)}]`,
          depth + 1,
        );
      });
      if (node.children.length > limit)
        result.push({
          node,
          key: "",
          path,
          jsonPath,
          depth: depth + 1,
          more: true,
        });
    };
    visit(root, "$", "", "$", 0);
    return result;
  }, [root, state, defaultDepth, version]);
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 28,
    overscan: 8,
  });
  useEffect(() => {
    if (state.hit === undefined) return;
    const index = rows.findIndex((row) => row.path === state.hit);
    if (index >= 0) virtual.scrollToIndex(index, { align: "center" });
  }, [rows, state.hit, virtual]);
  const toggle = (row: Row, recursive: boolean) => {
    const open = !isOpen(row.path, row.depth);
    state.open.set(row.path, open);
    if (recursive) {
      // Apply recursively by pointer prefix to existing overrides. Default
      // descendants use explicit entries (bounded to this record's nodes).
      const visit = (node: JsonNode, path: string) => {
        state.open.set(path, open);
        node.children?.forEach(({ key, node }) =>
          visit(node, pointer(path, key)),
        );
      };
      visit(row.node, row.path);
    }
    update((n) => n + 1);
  };
  return (
    <div
      ref={scroll}
      className="tree-scroll"
      style={{ height: Math.min(rows.length * 28 + 8, 420) }}
      role="tree"
      aria-label="JSON"
    >
      <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
        {virtual.getVirtualItems().map((item) => {
          const row = rows[item.index];
          if (row.more)
            return (
              <div
                key={`more:${row.path}`}
                className="tree-row"
                style={{
                  transform: `translateY(${item.start}px)`,
                  paddingLeft: row.depth * 20 + 16,
                }}
              >
                <button
                  className="load-more"
                  onClick={() => {
                    state.limits.set(
                      row.path,
                      (state.limits.get(row.path) ?? 50) + 50,
                    );
                    update((n) => n + 1);
                  }}
                >
                  {t("more")}{" "}
                  <span>
                    (
                    {row.node.children!.length -
                      (state.limits.get(row.path) ?? 50)}
                    )
                  </span>
                </button>
              </div>
            );
          const container = Boolean(row.node.children);
          const opened = isOpen(row.path, row.depth);
          return (
            <div
              key={row.path}
              className={`tree-row ${state.hit === row.path ? "search-hit" : ""}`}
              role="treeitem"
              aria-level={row.depth + 1}
              aria-expanded={container ? opened : undefined}
              style={{
                transform: `translateY(${item.start}px)`,
                paddingLeft: row.depth * 20 + 12,
              }}
            >
              {container ? (
                <button
                  className={`disclosure ${opened ? "opened" : ""}`}
                  aria-label={`${opened ? t("collapse") : t("expand")} ${row.key}`}
                  onClick={(e) => toggle(row, e.altKey)}
                >
                  <ChevronRight size={13} />
                </button>
              ) : (
                <span className="leaf-spacer" />
              )}
              <span className={`node-key ${row.depth === 0 ? "root-key" : ""}`}>
                {row.key}
              </span>
              <span className="colon">:</span>
              <span className={`type-tag type-${row.node.type}`}>
                {row.node.type}
              </span>
              {container ? (
                <span className="node-preview">
                  {row.node.type === "object" ? "{" : "["}{" "}
                  {row.node.children!.length}{" "}
                  {row.node.type === "object" ? "keys" : "items"}{" "}
                  {row.node.type === "object" ? "}" : "]"}
                  {!opened && (
                    <span className="preview-keys">
                      {" "}
                      {row.node
                        .children!.slice(0, 3)
                        .map((c) =>
                          row.node.type === "object"
                            ? c.key
                            : c.node.text.slice(0, 20),
                        )
                        .join(", ")}
                      {row.node.children!.length > 3 ? ", …" : ""}
                    </span>
                  )}
                </span>
              ) : (
                <span
                  className={`node-value value-${row.node.type}`}
                  title={row.node.text}
                >
                  {row.node.text.slice(0, 500)}
                  {row.node.text.length > 500 ? "…" : ""}
                </span>
              )}
              <button
                className="node-menu-button"
                aria-label={`${t("copy")} ${row.key}`}
                onClick={() => setMenu(menu === row.path ? null : row.path)}
              >
                <MoreHorizontal size={14} />
              </button>
              {menu === row.path && (
                <div
                  className="node-menu"
                  role="menu"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setMenu(null);
                  }}
                >
                  {[
                    [t("copyKey"), row.key],
                    [
                      t("copyValue"),
                      row.node.type === "string"
                        ? (JSON.parse(row.node.text) as string)
                        : row.node.text,
                    ],
                    [t("copyPath"), row.jsonPath],
                    [t("copyNode"), row.node.text],
                  ].map(([label, value]) => (
                    <button
                      key={label}
                      role="menuitem"
                      onClick={() => {
                        copy(value);
                        setMenu(null);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                  <button
                    role="menuitem"
                    onClick={() => {
                      search(
                        row.key === "$" ? row.node.text.slice(0, 200) : row.key,
                      );
                      setMenu(null);
                    }}
                  >
                    {t("fileSearch")}
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      edit();
                      setMenu(null);
                    }}
                  >
                    {t("edit")}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
