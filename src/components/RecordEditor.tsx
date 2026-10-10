import { useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { useTranslation } from "react-i18next";
import { X, Check, Pencil } from "lucide-react";

export function RecordEditor({
  text,
  title,
  onApply,
  onClose,
}: {
  text: string;
  title: string;
  onApply: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          history(),
          json(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.contentAttributes.of({ "aria-label": t("recordJson") }),
          EditorView.lineWrapping,
          EditorView.theme({
            "&": { height: "350px", fontSize: "12px" },
            ".cm-scroller": { overflow: "auto", fontFamily: "var(--code)" },
            ".cm-gutters": {
              background: "var(--chrome)",
              color: "var(--muted)",
              borderRight: "1px solid var(--border)",
            },
            ".cm-content": { caretColor: "var(--accent)" },
          }),
        ],
      }),
    });
    view.current = editor;
    editor.focus();
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, [text, t]);
  const apply = async () => {
    setBusy(true);
    setError("");
    try {
      await onApply(view.current?.state.doc.toString() ?? text);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <section
        className="paste-modal editor-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-title"
      >
        <header>
          <Pencil size={20} />
          <h2 id="editor-title">{title}</h2>
          <button
            className="icon-button"
            aria-label={t("close")}
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <p>{t("editHint")}</p>
        <div ref={host} className="code-editor" />
        {error && (
          <p className="error-color" role="alert">
            {error}
          </p>
        )}
        <footer>
          <span>JSON · 2 MiB max</span>
          <button className="button" disabled={busy} onClick={onClose}>
            {t("cancel")}
          </button>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void apply()}
          >
            <Check size={14} />
            {busy ? t("loading") : t("apply")}
          </button>
        </footer>
      </section>
    </div>
  );
}
