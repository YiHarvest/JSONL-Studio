import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight, LoaderCircle, MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { pointer, type TreeNodeSummary, type TreePage } from "../../model";
import { readTreeNode } from "../../bridge";
import { HighlightText } from "../HighlightText";
import type { TreeState } from "./JsonTree";

interface LoadedNode {
  summary: TreeNodeSummary;
  children: TreePage["children"];
  totalChildren: number;
  loading: boolean;
  error?: string;
}

interface Row {
  route: number[];
  routeKey: string;
  stateKey: string;
  jsonPath: string;
  pointer: string;
  key: string;
  node: TreeNodeSummary;
  depth: number;
  more?: boolean;
  remaining?: number;
}

const routeKey = (route: number[]) => route.join("/");
const stateKey = (route: number[]) => `lazy:${routeKey(route)}`;
const isContainer = (node: TreeNodeSummary) =>
  node.kind === "object" || node.kind === "array";

export function LazyJsonTree({
  line,
  state,
  defaultDepth,
  copy,
  search,
  query,
  fontScale,
}: {
  line: number;
  state: TreeState;
  defaultDepth: number;
  copy: (text: string) => void;
  search: (text: string) => void;
  query: string;
  fontScale: number;
}) {
  const { t } = useTranslation();
  const [nodes, setNodes] = useState<Map<string, LoadedNode>>(new Map());
  const [menu, setMenu] = useState<string | null>(null);
  const [version, update] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const rowHeight = Math.round(28 * fontScale);

  const load = useCallback(
    async (route: number[], offset = 0) => {
      const key = routeKey(route);
      setNodes((current) => {
        const next = new Map(current);
        const existing = next.get(key);
        next.set(key, {
          summary:
            existing?.summary ??
            ({
              kind: "object",
              text: "{",
              childCount: null,
              truncated: false,
            } satisfies TreeNodeSummary),
          children: existing?.children ?? [],
          totalChildren: existing?.totalChildren ?? 0,
          loading: true,
        });
        return next;
      });
      try {
        const page = await readTreeNode(line, route, offset);
        setNodes((current) => {
          const next = new Map(current);
          const existing = next.get(key);
          next.set(key, {
            summary: page.node,
            children:
              offset === 0
                ? page.children
                : [...(existing?.children ?? []), ...page.children],
            totalChildren: page.totalChildren,
            loading: false,
          });
          return next;
        });
      } catch (error) {
        setNodes((current) => {
          const next = new Map(current);
          const existing = next.get(key);
          next.set(key, {
            summary:
              existing?.summary ??
              ({
                kind: "object",
                text: "{",
                childCount: null,
                truncated: false,
              } satisfies TreeNodeSummary),
            children: existing?.children ?? [],
            totalChildren: existing?.totalChildren ?? 0,
            loading: false,
            error: String(error),
          });
          return next;
        });
      }
    },
    [line],
  );

  useEffect(() => {
    setNodes(new Map());
    state.open.set(stateKey([]), true);
    void load([]);
  }, [line, load, state]);

  const isOpen = useCallback(
    (route: number[], depth: number) =>
      state.open.get(stateKey(route)) ?? depth < defaultDepth,
    [defaultDepth, state],
  );

  const rows = useMemo(() => {
    void version;
    const root = nodes.get("");
    if (!root) return [];
    const result: Row[] = [];
    const visit = (
      route: number[],
      key: string,
      jsonPointer: string,
      jsonPath: string,
      node: TreeNodeSummary,
      depth: number,
    ) => {
      if (result.length >= 10000) return;
      const keyForRoute = routeKey(route);
      result.push({
        route,
        routeKey: keyForRoute,
        stateKey: stateKey(route),
        jsonPath,
        pointer: jsonPointer,
        key,
        node,
        depth,
      });
      if (!isContainer(node) || !isOpen(route, depth)) return;
      const loaded = nodes.get(keyForRoute);
      loaded?.children.forEach((child) => {
        const childRoute = [...route, child.index];
        visit(
          childRoute,
          child.key,
          pointer(jsonPointer, child.key),
          node.kind === "array"
            ? `${jsonPath}[${child.key}]`
            : `${jsonPath}[${JSON.stringify(child.key)}]`,
          child.node,
          depth + 1,
        );
      });
      if (
        loaded &&
        !loaded.loading &&
        loaded.children.length < loaded.totalChildren
      )
        result.push({
          route,
          routeKey: keyForRoute,
          stateKey: stateKey(route),
          jsonPath,
          pointer: jsonPointer,
          key: "",
          node,
          depth: depth + 1,
          more: true,
          remaining: loaded.totalChildren - loaded.children.length,
        });
    };
    visit([], "$", "", "$", root.summary, 0);
    return result;
  }, [isOpen, nodes, version]);

  useEffect(() => {
    for (const row of rows) {
      if (
        !row.more &&
        isContainer(row.node) &&
        isOpen(row.route, row.depth) &&
        !nodes.has(row.routeKey)
      ) {
        void load(row.route);
      }
    }
  }, [isOpen, load, nodes, rows]);

  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => rowHeight,
    overscan: 8,
  });
  useEffect(() => virtual.measure(), [rowHeight, virtual]);

  const toggle = (row: Row, recursive: boolean) => {
    const open = !isOpen(row.route, row.depth);
    state.open.set(row.stateKey, open);
    if (open && !nodes.has(row.routeKey)) void load(row.route);
    if (recursive) {
      for (const candidate of rows) {
        if (
          candidate.routeKey === row.routeKey ||
          row.routeKey === "" ||
          candidate.routeKey.startsWith(`${row.routeKey}/`)
        )
          state.open.set(candidate.stateKey, open);
      }
    }
    update((value) => value + 1);
  };

  if (!nodes.has(""))
    return (
      <div className="lazy-tree-status">
        <LoaderCircle size={15} className="spin" />
        {t("loadingTree")}
      </div>
    );

  return (
    <div
      ref={scroll}
      className="tree-scroll"
      style={{
        height: Math.min(
          Math.max(rows.length, 1) * rowHeight + 8,
          Math.round(420 * fontScale),
        ),
      }}
      role="tree"
      aria-label="JSON"
    >
      <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
        {virtual.getVirtualItems().map((item) => {
          const row = rows[item.index];
          const loaded = nodes.get(row.routeKey);
          if (row.more)
            return (
              <div
                key={`more:${row.routeKey}`}
                className="tree-row"
                style={{
                  transform: `translateY(${item.start}px)`,
                  paddingLeft: row.depth * 20 + 16,
                }}
              >
                <button
                  className="load-more"
                  disabled={loaded?.loading}
                  onClick={() =>
                    void load(row.route, loaded?.children.length ?? 0)
                  }
                >
                  {loaded?.loading ? t("loading") : t("more")}{" "}
                  <span>({row.remaining})</span>
                </button>
              </div>
            );
          const container = isContainer(row.node);
          const opened = isOpen(row.route, row.depth);
          return (
            <div
              key={row.routeKey || "root"}
              className="tree-row"
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
                  onClick={(event) => toggle(row, event.altKey)}
                >
                  <ChevronRight size={13} />
                </button>
              ) : (
                <span className="leaf-spacer" />
              )}
              <span className={`node-key ${row.depth === 0 ? "root-key" : ""}`}>
                <HighlightText text={row.key} query={query} />
              </span>
              <span className="colon">:</span>
              <span className={`type-tag type-${row.node.kind}`}>
                {row.node.kind}
              </span>
              {container ? (
                <span className="node-preview">
                  {row.node.kind === "object" ? "{" : "["}{" "}
                  {row.node.childCount ?? loaded?.totalChildren ?? "…"}{" "}
                  {row.node.kind === "object" ? "keys" : "items"}{" "}
                  {row.node.kind === "object" ? "}" : "]"}
                  {loaded?.loading && (
                    <LoaderCircle size={12} className="spin inline-loader" />
                  )}
                  {loaded?.error && (
                    <span className="error-color"> {loaded.error}</span>
                  )}
                </span>
              ) : (
                <span
                  className={`node-value value-${row.node.kind}`}
                  title={row.node.text}
                >
                  <HighlightText text={row.node.text} query={query} />
                  {row.node.truncated ? "…" : ""}
                </span>
              )}
              <button
                className="node-menu-button"
                aria-label={`${t("copy")} ${row.key}`}
                onClick={() =>
                  setMenu(menu === row.routeKey ? null : row.routeKey)
                }
              >
                <MoreHorizontal size={14} />
              </button>
              {menu === row.routeKey && (
                <div className="node-menu" role="menu">
                  <button
                    role="menuitem"
                    onClick={() => {
                      copy(row.key);
                      setMenu(null);
                    }}
                  >
                    {t("copyKey")}
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      copy(row.jsonPath);
                      setMenu(null);
                    }}
                  >
                    {t("copyPath")}
                  </button>
                  {!container && (
                    <button
                      role="menuitem"
                      onClick={() => {
                        copy(row.node.text);
                        setMenu(null);
                      }}
                    >
                      {t(row.node.truncated ? "copyPreview" : "copyValue")}
                    </button>
                  )}
                  <button
                    role="menuitem"
                    onClick={() => {
                      search(row.key === "$" ? row.node.text : row.key);
                      setMenu(null);
                    }}
                  >
                    {t("fileSearch")}
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
