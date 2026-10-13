import { type ReactNode, useMemo, useState } from "react";
import {
  ChevronRight,
  Copy,
  CircleAlert,
  Braces,
  Pencil,
  CopyPlus,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  parseTree,
  pretty,
  sizeLabel,
  type RecordData,
  type ViewMode,
} from "../model";
import { HighlightText } from "./HighlightText";
import { JsonTree, type TreeState } from "./tree/JsonTree";

export function RecordCard({
  record,
  mode,
  treeState,
  depth,
  copy,
  edit,
  duplicate,
  remove,
  disabled,
  search,
  query,
  fontScale,
  inlineEditor,
}: {
  record: RecordData;
  mode: ViewMode;
  treeState: TreeState;
  depth: number;
  copy: (text: string) => void;
  edit: () => void;
  duplicate: () => void;
  remove: () => void;
  disabled: boolean;
  search: (text: string) => void;
  query: string;
  fontScale: number;
  inlineEditor?: ReactNode;
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
      className={`record-card ${record.error ? "invalid" : record.truncated ? "limited" : ""}`}
      data-line={record.line}
    >
      <header className="record-header">
        <button
          className="icon-button"
          disabled={disabled || record.truncated}
          aria-label={`${t("edit")} L${record.line}`}
          onClick={edit}
        >
          <Pencil size={13} />
        </button>
        <button
          className="icon-button"
          disabled={disabled || record.truncated}
          aria-label={`${t("duplicate")} L${record.line}`}
          onClick={duplicate}
        >
          <CopyPlus size={13} />
        </button>
        <button
          className="icon-button"
          disabled={disabled}
          aria-label={`${t("delete")} L${record.line}`}
          onClick={remove}
        >
          <Trash2 size={13} />
        </button>
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
        ) : record.truncated ? (
          <CircleAlert size={13} className="limited-color" />
        ) : (
          <Braces size={13} className="muted" />
        )}
        <span className="record-description">
          {record.error
            ? t("error")
            : record.truncated
              ? t("previewLimited")
              : (parsed?.type ?? "JSON")}
          {parsed?.children
            ? ` · ${parsed.children.length} ${parsed.type === "array" ? "items" : "keys"}`
            : ""}
        </span>
        <span className="record-bytes">
          {sizeLabel(new TextEncoder().encode(record.raw).length)}
          {record.truncated ? "+" : ""}
        </span>
        <button
          className="icon-button"
          aria-label={`${t(record.truncated ? "copyPreview" : "copy")} L${record.line}`}
          onClick={() => copy(record.raw)}
        >
          <Copy size={13} />
        </button>
      </header>
      {inlineEditor ??
        (!collapsed &&
          (record.truncated ? (
            <div className="record-limit">
              <div className="limit-message">
                <CircleAlert size={15} />
                <span>{t("previewLimitNotice")}</span>
              </div>
              <pre>
                <HighlightText text={record.raw || "∅"} query={query} />
              </pre>
            </div>
          ) : record.error ? (
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
              <pre>
                <HighlightText text={record.raw || "∅"} query={query} />
              </pre>
            </div>
          ) : mode === "tree" && parsed ? (
            <JsonTree
              root={parsed}
              state={treeState}
              defaultDepth={depth}
              copy={copy}
              edit={edit}
              search={search}
              query={query}
              fontScale={fontScale}
            />
          ) : (
            <pre className={`record-raw ${mode === "wrap" ? "wrapped" : ""}`}>
              <HighlightText
                text={mode === "pretty" && parsed ? pretty(parsed) : record.raw}
                query={query}
              />
            </pre>
          )))}
    </article>
  );
}
