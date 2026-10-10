import { useMemo, useState } from "react";
import { ChevronRight, Copy, CircleAlert, Braces } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  parseTree,
  pretty,
  sizeLabel,
  type RecordData,
  type ViewMode,
} from "../model";
import { JsonTree, type TreeState } from "./tree/JsonTree";

export function RecordCard({
  record,
  mode,
  treeState,
  depth,
  copy,
}: {
  record: RecordData;
  mode: ViewMode;
  treeState: TreeState;
  depth: number;
  copy: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(treeState.collapsed ?? false);
  const parsed = useMemo(() => {
    try {
      return record.json ? parseTree(record.json) : null;
    } catch {
      return null;
    }
  }, [record.json]);
  return (
    <article
      className={`record-card ${record.error ? "invalid" : ""}`}
      data-line={record.line}
    >
      <header className="record-header">
        <button
          className={`disclosure ${collapsed ? "" : "opened"}`}
          aria-label={`${collapsed ? t("expand") : t("collapse")} ${record.line}`}
          onClick={() => {
            treeState.collapsed = !collapsed;
            setCollapsed(!collapsed);
          }}
        >
          <ChevronRight size={14} />
        </button>
        <span className="line-label">L{record.line.toLocaleString()}</span>
        {record.error ? (
          <CircleAlert size={13} className="error-color" />
        ) : (
          <Braces size={13} className="muted" />
        )}
        <span className="record-description">
          {record.error ? t("error") : (parsed?.type ?? "JSON")}
          {parsed?.children
            ? ` · ${parsed.children.length} ${parsed.type === "array" ? "items" : "keys"}`
            : ""}
        </span>
        <span className="record-bytes">
          {sizeLabel(new TextEncoder().encode(record.raw).length)}
        </span>
        <button
          className="icon-button"
          aria-label={`${t("copy")} L${record.line}`}
          onClick={() => copy(record.raw)}
        >
          <Copy size={13} />
        </button>
      </header>
      {!collapsed &&
        (record.error ? (
          <div className="record-error">
            <div className="error-message">
              <CircleAlert size={15} />
              <span>
                {record.error}
                {record.column != null
                  ? ` · ${t("column")} ${record.column}`
                  : ""}
              </span>
            </div>
            <pre>{record.raw || "∅"}</pre>
          </div>
        ) : mode === "tree" && parsed ? (
          <JsonTree
            root={parsed}
            state={treeState}
            defaultDepth={depth}
            copy={copy}
          />
        ) : (
          <pre className={`record-raw ${mode === "wrap" ? "wrapped" : ""}`}>
            {mode === "pretty" && parsed ? pretty(parsed) : record.raw}
          </pre>
        ))}
    </article>
  );
}
