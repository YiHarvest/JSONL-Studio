import {
  lazy,
  Suspense,
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open, save, confirm } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import {
  Braces,
  FilePlus2,
  FolderOpen,
  Search,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  SunMoon,
  Languages,
  Check,
  X,
  Copy,
  FileJson2,
  AlertCircle,
  LoaderCircle,
  Save,
  Plus,
  PanelLeft,
  PanelRight,
  ZoomIn,
  ZoomOut,
  SaveAll,
  AlignLeft,
  WrapText,
  Rows3,
  FileCode2,
  SlidersHorizontal,
} from "lucide-react";
import {
  desktop,
  importText,
  readPage,
  validateFile,
  editRecord,
  searchDocument,
} from "./bridge";
import {
  sizeLabel,
  pretty,
  parseTree,
  type Edit,
  type Info,
  type Page,
  type ViewMode,
  type SearchHit,
} from "./model";
const RecordEditor = lazy(() =>
  import("./components/RecordEditor").then((module) => ({
    default: module.RecordEditor,
  })),
);
import { RecordCard } from "./components/RecordCard";
import { HighlightText } from "./components/HighlightText";
import type { TreeState } from "./components/tree/JsonTree";
import { LazyJsonTree } from "./components/tree/LazyJsonTree";
import i18n, { systemLanguage } from "./i18n";
import { sample } from "./sample";
import packageInfo from "../package.json";

const MAX_DOCUMENT_DRAFT = 8 * 1024 * 1024;

export default function App() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<Info | null>(null);
  const [page, setPage] = useState<Page>({
    records: [],
    nextLine: 1,
    hasMore: false,
  });
  const [mode, setMode] = useState<ViewMode>("tree");
  const [quantity, setQuantity] = useState("100");
  const [customCount, setCustomCount] = useState(100);
  const [start, setStart] = useState(1);
  const [jump, setJump] = useState("1");
  const [busy, setBusy] = useState(false);
  const [validating, setValidating] = useState(false);
  const [stats, setStats] = useState<[number, number] | null>(null);
  const [error, setError] = useState("");
  const [changed, setChanged] = useState(false);
  const [documentDraftOpen, setDocumentDraftOpen] = useState(false);
  const [documentDraft, setDocumentDraft] = useState("");
  const [query, setQuery] = useState("");
  const [activeHit, setActiveHit] = useState(-1);
  const [editor, setEditor] = useState<{
    line: number;
    text: string;
    insert: boolean;
  } | null>(null);
  const [searchMode, setSearchMode] = useState("raw");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchScanned, setSearchScanned] = useState(0);
  const [recoverable, setRecoverable] = useState(false);
  const searchToken = useRef(0);
  const searchTimer = useRef<number | undefined>(undefined);
  const [depth, setDepth] = useState(2);
  const [treeVersion, setTreeVersion] = useState(0);
  const [toast, setToast] = useState("");
  const [language, setLanguage] = useState(
    localStorage.getItem("language") ?? "system",
  );
  const [theme, setTheme] = useState(localStorage.getItem("theme") ?? "system");
  const [detailsOpen, setDetailsOpen] = useState(
    localStorage.getItem("detailsOpen") !== "false",
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [fontScale, setFontScale] = useState(() => {
    const stored = Number(localStorage.getItem("fontScale") ?? 100);
    return Number.isFinite(stored) ? Math.min(180, Math.max(80, stored)) : 100;
  });
  const states = useRef(new Map<number, TreeState>());
  const scroll = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const jumpInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const history = useRef<number[]>([]);
  const infoRef = useRef(info);
  infoRef.current = info;
  const documentDraftRef = useRef(documentDraft);
  documentDraftRef.current = documentDraft;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const count =
    quantity === "all"
      ? 1000
      : quantity === "custom"
        ? Math.max(1, Math.min(1000, customCount))
        : Number(quantity);
  const countRef = useRef(count);
  countRef.current = count;
  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setToast(t("copied"));
      } catch (e) {
        setError(String(e));
      }
    },
    [t],
  );
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    localStorage.setItem("theme", theme);
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    localStorage.setItem("detailsOpen", String(detailsOpen));
  }, [detailsOpen]);
  useEffect(() => {
    localStorage.setItem("fontScale", String(fontScale));
  }, [fontScale]);
  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [language]);

  const load = useCallback(async (line: number, amount: number) => {
    const token = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const data = await readPage(line, amount);
      if (token !== generation.current) return;
      setPage(data);
      setStart(line);
      setJump(String(line));
      scroll.current?.scrollTo({ top: 0 });
    } catch (e) {
      if (token === generation.current) setError(String(e));
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }, []);
  const install = useCallback(
    async (next: Info) => {
      setInfo(next);
      setStats(null);
      setChanged(false);
      setQuery("");
      searchToken.current++;
      setSearching(false);
      setHits([]);
      setActiveHit(-1);
      setSearchOpen(false);
      setDocumentDraftOpen(false);
      setDocumentDraft("");
      states.current.clear();
      history.current = [];
      setDepth(2);
      setTreeVersion((v) => v + 1);
      await load(1, countRef.current);
    },
    [load],
  );
  const allowReplace = useCallback(
    async () =>
      (!infoRef.current?.dirty && !documentDraftRef.current.trim()) ||
      (desktop
        ? confirm(t("replaced"), { title: "JSONL Studio", kind: "warning" })
        : window.confirm(t("replaced"))),
    [t],
  );
  const openPath = useCallback(
    async (path: string) => {
      if (busyRef.current || !(await allowReplace())) return;
      setBusy(true);
      setError("");
      try {
        await install(await invoke<Info>("open_file", { path }));
      } catch (e) {
        setError(String(e));
        setBusy(false);
      }
    },
    [install, allowReplace],
  );
  const openFile = useCallback(async () => {
    if (!desktop) {
      setToast(t("browser"));
      return;
    }
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "JSON Lines", extensions: ["jsonl", "ndjson"] }],
      });
      if (typeof path === "string") await openPath(path);
    } catch (e) {
      setError(String(e));
    }
  }, [openPath, t]);
  const importData = useCallback(
    async (text: string, confirmReplace = true) => {
      if (busyRef.current || (confirmReplace && !(await allowReplace())))
        return;
      setBusy(true);
      setError("");
      try {
        await install(await importText(text));
        setDocumentDraftOpen(false);
        setDocumentDraft("");
      } catch (e) {
        setError(String(e));
        setBusy(false);
      }
    },
    [install, allowReplace],
  );
  const createDocument = useCallback(async () => {
    if (busyRef.current || !(await allowReplace())) return;
    setBusy(true);
    setError("");
    try {
      setDocumentDraft("");
      await install(await importText(""));
      setDocumentDraftOpen(true);
      if (window.matchMedia("(max-width: 1050px)").matches)
        setDetailsOpen(false);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }, [allowReplace, install]);
  const applyEdit = async (edit: Edit) => {
    if (!info || busyRef.current) throw new Error("Document is busy");
    setBusy(true);
    try {
      const next = await editRecord(edit, info.revision);
      setInfo(next);
      setStats(null);
      states.current.clear();
      searchToken.current++;
      setHits([]);
      setActiveHit(-1);
      setQuery("");
      history.current = [];
      setTreeVersion((v) => v + 1);
      const target =
        edit.kind === "duplicate"
          ? edit.line + 1
          : edit.kind === "delete"
            ? Math.min(edit.line, next.totalLines || 1)
            : edit.line;
      await load(Math.max(1, Math.min(target, next.totalLines || 1)), count);
      setToast(t("appliedUnsaved"));
    } finally {
      setBusy(false);
    }
  };
  const saveDocument = useCallback(
    async (saveAs = false) => {
      const current = infoRef.current;
      if (!current || busyRef.current) return;
      if (!desktop) {
        setToast(t("browserSave"));
        return;
      }
      let path = current.path;
      if (saveAs || !path)
        path = await save({
          defaultPath: current.name,
          filters: [{ name: "JSON Lines", extensions: ["jsonl", "ndjson"] }],
        });
      if (!path) return;
      setBusy(true);
      setError("");
      try {
        let next: Info;
        try {
          next = await invoke("save_document", {
            path,
            overwrite: false,
            revision: current.revision,
          });
        } catch (e) {
          if (!String(e).includes("Destination exists")) throw e;
          if (
            !(await confirm(t("overwrite"), {
              title: "JSONL Studio",
              kind: "warning",
            }))
          )
            return;
          next = await invoke("save_document", {
            path,
            overwrite: true,
            revision: current.revision,
          });
        }
        setInfo(next);
        setChanged(false);
        setRecoverable(false);
        setToast(t("saved"));
        await load(start, countRef.current);
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [load, t, start],
  );
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    void invoke<boolean>("recovery_available").then((value) => {
      if (!disposed) setRecoverable(value);
    });
    const close = getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      if (
        !infoRef.current?.dirty ||
        (await confirm(t("closeUnsaved"), {
          title: "JSONL Studio",
          kind: "warning",
        }))
      )
        await getCurrentWindow().destroy();
    });
    return () => {
      disposed = true;
      void close.then((fn) => fn());
    };
  }, [t]);
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    const cleanups: (() => void)[] = [];
    const pending = async () => {
      if (disposed || busyRef.current) return;
      if ((await invoke<boolean>("recovery_available")) && !infoRef.current)
        return;
      const paths = await invoke<string[]>("pending_files");
      if (paths.length) await openPath(paths[paths.length - 1]);
    };
    void listen("files-opened", () => {
      void pending().catch((e) => setError(String(e)));
    }).then((fn) => {
      if (disposed) fn();
      else cleanups.push(fn);
    });
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "drop" && event.payload.paths.length)
          void openPath(event.payload.paths[0]);
      })
      .then((fn) => {
        if (disposed) fn();
        else cleanups.push(fn);
      });
    void pending().catch((e) => setError(String(e)));
    return () => {
      disposed = true;
      cleanups.forEach((fn) => fn());
    };
  }, [openPath]);
  useEffect(() => {
    if (!desktop || !info?.path) return;
    const id = setInterval(() => {
      void invoke<boolean>("file_changed")
        .then(setChanged)
        .catch(() => setChanged(true));
    }, 2000);
    return () => clearInterval(id);
  }, [info]);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      switch (e.key.toLowerCase()) {
        case "o":
          e.preventDefault();
          void openFile();
          break;
        case "n":
          e.preventDefault();
          void createDocument();
          break;
        case "f":
          e.preventDefault();
          searchInput.current?.focus();
          break;
        case "g":
          e.preventDefault();
          jumpInput.current?.focus();
          jumpInput.current?.select();
          break;
        case "s":
          e.preventDefault();
          void saveDocument(e.shiftKey);
          break;
        case "=":
        case "+":
          e.preventDefault();
          setFontScale((value) => Math.min(180, value + 10));
          break;
        case "-":
          e.preventDefault();
          setFontScale((value) => Math.max(80, value - 10));
          break;
        case "0":
          e.preventDefault();
          setFontScale(100);
          break;
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [openFile, createDocument, saveDocument]);

  const records = page.records;
  const jumpHit = async (hit: SearchHit) => {
    if (searchMode === "raw") {
      setMode("wrap");
      await load(hit.line, count);
      return;
    }
    let state = states.current.get(hit.line);
    if (!state) {
      state = { open: new Map(), limits: new Map() };
      states.current.set(hit.line, state);
    }
    state.collapsed = false;
    state.hit = hit.pointer;
    const tokens = hit.pointer.split("/").slice(1);
    let parent = "";
    state.open.set("", true);
    for (const token of tokens) {
      state.open.set(parent, true);
      const index = Number(token);
      if (Number.isInteger(index) && index >= 0)
        state.limits.set(
          parent,
          Math.max(50, Math.ceil((index + 1) / 50) * 50),
        );
      parent += `/${token}`;
      state.open.set(parent, true);
    }
    setMode("tree");
    setTreeVersion((v) => v + 1);
    await load(hit.line, count);
  };
  const runSearch = useCallback(async () => {
    if (!query.trim() || !info) return;
    const token = ++searchToken.current;
    const text = query;
    setSearching(true);
    setHits([]);
    setActiveHit(-1);
    setSearchScanned(0);
    setError("");
    let line = 1;
    const found: SearchHit[] = [];
    try {
      while (token === searchToken.current && found.length < 500) {
        const result = await searchDocument(text, searchMode, line);
        if (token !== searchToken.current) break;
        found.push(...result.hits);
        setHits(found.slice(0, 500));
        setSearchScanned(result.nextLine - 1);
        if (!result.hasMore) break;
        line = result.nextLine;
      }
    } catch (e) {
      if (token === searchToken.current) setError(String(e));
    } finally {
      if (token === searchToken.current) setSearching(false);
    }
  }, [info, query, searchMode]);
  useEffect(() => {
    searchToken.current++;
    window.clearTimeout(searchTimer.current);
    setActiveHit(-1);
    if (!query.trim() || !info) {
      setSearching(false);
      setHits([]);
      setSearchScanned(0);
      return;
    }
    setSearchOpen(true);
    searchTimer.current = window.setTimeout(() => void runSearch(), 250);
    return () => window.clearTimeout(searchTimer.current);
  }, [info, query, runSearch, searchMode]);
  const virtual = useVirtualizer({
    count: records.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => (mode === "tree" ? 240 : 160) * (fontScale / 100),
    overscan: 3,
    getItemKey: (index) => records[index].line,
  });
  useEffect(() => {
    virtual.measure();
  }, [mode, depth, treeVersion, fontScale, virtual]);
  const stateFor = (line: number) => {
    if (!states.current.has(line))
      states.current.set(line, { open: new Map(), limits: new Map() });
    return states.current.get(line)!;
  };
  const setTreeDepth = (value: number) => {
    states.current.forEach((s) => s.open.clear());
    setDepth(value);
    setTreeVersion((v) => v + 1);
  };
  const changeCount = (value: string) => {
    setQuantity(value);
    history.current = [];
    if (info)
      void load(
        start,
        value === "all"
          ? 1000
          : value === "custom"
            ? customCount
            : Number(value),
      );
  };
  const validate = async () => {
    setValidating(true);
    setError("");
    const token = generation.current;
    try {
      const result = await validateFile();
      if (token === generation.current) setStats(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setValidating(false);
    }
  };
  const visibleErrors = page.records.filter((r) => r.error).length;
  const visibleLimited = page.records.filter((r) => r.truncated).length;
  const visibleValid = page.records.length - visibleErrors - visibleLimited;
  const isMac = navigator.userAgent.includes("Mac");
  return (
    <div
      className={`app ${isMac && desktop ? "mac" : ""}`}
      style={
        {
          "--reader-font-scale": fontScale / 100,
        } as CSSProperties
      }
    >
      <header className="titlebar" data-tauri-drag-region>
        <div className="titlebar-leading">
          <div className="brand" data-tauri-drag-region>
            <span className="brand-icon">
              <Braces size={18} strokeWidth={2.1} />
            </span>
            <span className="brand-name">JSONL Studio</span>
          </div>
          {info && (
            <button
              className={`icon-button titlebar-command panel-toggle ${detailsOpen ? "active" : ""}`}
              aria-label={t("navigator")}
              aria-pressed={detailsOpen}
              title={t("navigator")}
              onClick={() => setDetailsOpen((value) => !value)}
            >
              <PanelLeft size={17} />
            </button>
          )}
          <span className="titlebar-divider" />
          <button
            className="icon-button titlebar-command"
            disabled={busy}
            aria-label={t("open")}
            title={`${t("open")} · ${isMac ? "⌘" : "Ctrl+"}O`}
            onClick={() => void openFile()}
          >
            <FolderOpen size={17} />
          </button>
          <button
            className="icon-button titlebar-command"
            disabled={busy}
            aria-label={t("new")}
            title={`${t("new")} · ${isMac ? "⌘" : "Ctrl+"}N`}
            onClick={() => void createDocument()}
          >
            <FilePlus2 size={17} />
          </button>
          <button
            className="icon-button titlebar-command"
            disabled={!info || busy || changed || documentDraftOpen}
            aria-label={t("save")}
            title={`${t("save")} · ${isMac ? "⌘" : "Ctrl+"}S`}
            onClick={() => void saveDocument()}
          >
            <Save size={17} />
          </button>
          <button
            className="icon-button titlebar-command"
            disabled={!info || busy || changed || documentDraftOpen}
            aria-label={t("saveAs")}
            title={t("saveAs")}
            onClick={() => void saveDocument(true)}
          >
            <SaveAll size={17} />
          </button>
        </div>
        <div className="titlebar-search">
          <div className="search-box">
            <Search size={15} />
            <input
              ref={searchInput}
              aria-label={t("search")}
              placeholder={t("search")}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveHit(-1);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  window.clearTimeout(searchTimer.current);
                  void runSearch();
                }
              }}
            />
            {query && (
              <>
                <span className="match-count">
                  {searching ? "…" : hits.length}
                </span>
                <button
                  className="icon-button"
                  aria-label={t("findNext")}
                  onClick={() => {
                    if (hits.length) {
                      const next = (activeHit + 1) % hits.length;
                      setActiveHit(next);
                      void jumpHit(hits[next]);
                    }
                  }}
                >
                  <ChevronRight size={14} />
                </button>
                <button
                  className="icon-button"
                  aria-label={t("close")}
                  onClick={() => setQuery("")}
                >
                  <X size={13} />
                </button>
              </>
            )}
          </div>
          <select
            className="search-mode-select"
            aria-label={t("searchMode")}
            value={searchMode}
            onChange={(e) => setSearchMode(e.target.value)}
          >
            <option value="raw">{t("rawSearch")}</option>
            <option value="key">{t("keySearch")}</option>
            <option value="value">{t("valueSearch")}</option>
          </select>
        </div>
        <div className="titlebar-trailing">
          <div className="zoom-controls" aria-label={t("fontSize")}>
            <button
              className="icon-button"
              aria-label={t("zoomOut")}
              disabled={fontScale <= 80}
              onClick={() => setFontScale((value) => Math.max(80, value - 10))}
            >
              <ZoomOut size={16} />
            </button>
            <button
              className="zoom-value"
              title={`${isMac ? "⌘" : "Ctrl"}+0`}
              onClick={() => setFontScale(100)}
            >
              {fontScale}%
            </button>
            <button
              className="icon-button"
              aria-label={t("zoomIn")}
              disabled={fontScale >= 180}
              onClick={() => setFontScale((value) => Math.min(180, value + 10))}
            >
              <ZoomIn size={16} />
            </button>
          </div>
          {info && (
            <button
              className={`icon-button titlebar-command panel-toggle ${searchOpen ? "active" : ""}`}
              aria-label={t("searchResults")}
              aria-pressed={searchOpen}
              title={t("searchResults")}
              onClick={() => setSearchOpen((value) => !value)}
            >
              <PanelRight size={17} />
            </button>
          )}
          <label
            className={`preference icon-select ${language !== "system" ? "active" : ""}`}
            title={t("language")}
          >
            <Languages size={16} aria-hidden="true" />
            <select
              aria-label={t("language")}
              value={language}
              onChange={(e) => {
                const value = e.target.value;
                setLanguage(value);
                localStorage.setItem("language", value);
                void i18n.changeLanguage(
                  value === "system" ? systemLanguage() : value,
                );
              }}
            >
              <option value="system">{t("system")}</option>
              <option value="zh">简体中文</option>
              <option value="en">English</option>
            </select>
          </label>
          <label
            className={`preference icon-select ${theme !== "system" ? "active" : ""}`}
            title={t("theme")}
          >
            <SunMoon size={16} aria-hidden="true" />
            <select
              aria-label={t("theme")}
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
            >
              <option value="system">{t("system")}</option>
              <option value="light">{t("light")}</option>
              <option value="dark">{t("dark")}</option>
            </select>
          </label>
        </div>
      </header>
      {info ? (
        <div
          className={`workspace ${detailsOpen ? "details-open" : ""} ${searchOpen ? "search-open" : ""}`}
        >
          {detailsOpen && (
            <aside className="file-sidebar" aria-label={t("navigator")}>
              <header className="sidebar-header">
                <span>
                  <SlidersHorizontal size={15} />
                  {t("navigator")}
                </span>
                <button
                  className="icon-button"
                  aria-label={t("close")}
                  onClick={() => setDetailsOpen(false)}
                >
                  <X size={14} />
                </button>
              </header>
              <nav className="sidebar-section" aria-label={t("viewMode")}>
                <span className="sidebar-section-title">{t("views")}</span>
                <div className="view-list">
                  {(
                    ["tree", "pretty", "wrap", "raw", "source"] as ViewMode[]
                  ).map((value) => (
                    <button
                      key={value}
                      aria-pressed={mode === value}
                      className={mode === value ? "active" : ""}
                      onClick={() => setMode(value)}
                    >
                      {value === "tree" && <Braces size={15} />}
                      {value === "pretty" && <AlignLeft size={15} />}
                      {value === "wrap" && <WrapText size={15} />}
                      {value === "raw" && <Rows3 size={15} />}
                      {value === "source" && <FileCode2 size={15} />}
                      <span>{t(value)}</span>
                    </button>
                  ))}
                </div>
              </nav>
              <section className="sidebar-section">
                <span className="sidebar-section-title">
                  {t("documentActions")}
                </span>
                <button
                  className="sidebar-primary-action"
                  disabled={
                    busy || changed || Boolean(editor) || documentDraftOpen
                  }
                  onClick={() =>
                    setEditor({
                      line: info.totalLines + 1,
                      text: "{}",
                      insert: true,
                    })
                  }
                >
                  <Plus size={15} />
                  {t("add")}
                </button>
              </section>
              {mode === "tree" && (
                <section className="sidebar-section">
                  <span className="sidebar-section-title">
                    {t("treeOptions")}
                  </span>
                  <div className="tree-sidebar-actions">
                    <button onClick={() => setTreeDepth(129)}>
                      {t("expand")}
                    </button>
                    <button onClick={() => setTreeDepth(0)}>
                      {t("collapse")}
                    </button>
                  </div>
                  <div className="depth-selector">
                    {[1, 2, 3].map((value) => (
                      <button
                        className={depth === value ? "active" : ""}
                        key={value}
                        onClick={() => setTreeDepth(value)}
                      >
                        {t("depth")} {value}
                      </button>
                    ))}
                  </div>
                  <span className="sidebar-hint">
                    {isMac ? "Option" : "Alt"} + click
                  </span>
                </section>
              )}
              <section className="file-info">
                <span className="sidebar-section-title">
                  {t("fileDetails")}
                </span>
                <div className="file-heading">
                  <div>
                    <h1>
                      {info.name}
                      {info.dirty && (
                        <span className="unsaved-label">{t("unsaved")}</span>
                      )}
                    </h1>
                    <p title={info.path ?? ""}>
                      {info.path ?? t("scratchNotice")}
                    </p>
                  </div>
                </div>
                <div className="file-facts">
                  <div>
                    <span>{t("fileSize")}</span>
                    <strong>{sizeLabel(info.size)}</strong>
                    <span>
                      {info.encoding} · {info.newline}
                    </span>
                  </div>
                  <div>
                    <span>{t("recordCount")}</span>
                    <strong>
                      {info.totalLines.toLocaleString()}{" "}
                      <small>{t("lines")}</small>
                    </strong>
                    <span>
                      {info.modified
                        ? `${t("modified")} ${new Date(info.modified * 1000).toLocaleString()}`
                        : "JSONL / NDJSON"}
                    </span>
                  </div>
                  <div className="validation-fact">
                    <span>{t("validation")}</span>
                    <strong>
                      <span className="valid-color">
                        {stats
                          ? stats[0].toLocaleString()
                          : visibleValid.toLocaleString()}
                      </span>
                      <small> {t("valid")}</small>
                      <span
                        className={
                          visibleErrors || stats?.[1] ? "error-color" : ""
                        }
                      >
                        {" "}
                        · {stats ? stats[1].toLocaleString() : visibleErrors}
                      </span>
                      <small> {t("errors")}</small>
                      {!stats && visibleLimited > 0 && (
                        <>
                          <span className="limited-color">
                            {" "}
                            · {visibleLimited.toLocaleString()}
                          </span>
                          <small> {t("limited")}</small>
                        </>
                      )}
                    </strong>
                    <button
                      disabled={validating || busy || changed}
                      onClick={() => void validate()}
                    >
                      {validating ? t("validating") : t("validate")}
                    </button>
                  </div>
                </div>
              </section>
            </aside>
          )}
          <section className="editor-shell">
            <div className="document-bar">
              <div className="document-identity">
                <FileJson2 size={15} />
                <strong>{info.name}</strong>
                {info.dirty && (
                  <span className="unsaved-label">{t("unsaved")}</span>
                )}
              </div>
              <div className="range-controls">
                <label>
                  {t("show")}{" "}
                  <select
                    aria-label={t("show")}
                    value={quantity}
                    disabled={busy}
                    onChange={(e) => changeCount(e.target.value)}
                  >
                    {[10, 50, 100, 500, 1000].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                    <option value="all">{t("all")}</option>
                    <option value="custom">{t("custom")}</option>
                  </select>
                </label>
                {quantity === "custom" && (
                  <input
                    type="number"
                    aria-label={t("custom")}
                    min="1"
                    max="1000"
                    value={customCount}
                    onChange={(e) => setCustomCount(Number(e.target.value))}
                    onBlur={() => void load(start, count)}
                  />
                )}
                <label>
                  {t("from")}{" "}
                  <input
                    ref={jumpInput}
                    type="number"
                    min="1"
                    max={Math.max(1, info.totalLines)}
                    value={jump}
                    onChange={(e) => setJump(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !busy) {
                        history.current = [];
                        void load(
                          Math.max(
                            1,
                            Math.min(info.totalLines || 1, Number(jump) || 1),
                          ),
                          count,
                        );
                      }
                    }}
                  />
                </label>
                <button
                  className="small-button"
                  disabled={busy}
                  onClick={() => {
                    history.current = [];
                    void load(
                      Math.max(
                        1,
                        Math.min(info.totalLines || 1, Number(jump) || 1),
                      ),
                      count,
                    );
                  }}
                >
                  {t("go")}
                </button>
                <button
                  className="icon-button"
                  aria-label={t("previous")}
                  disabled={busy || start <= 1}
                  onClick={() =>
                    void load(
                      history.current.pop() ?? Math.max(1, start - count),
                      count,
                    )
                  }
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label={t("next")}
                  disabled={busy || !page.hasMore}
                  onClick={() => {
                    history.current.push(start);
                    void load(page.nextLine, count);
                  }}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
            {editor?.insert && (
              <div className="new-record-editor">
                <Suspense
                  fallback={<div className="loading">{t("loading")}</div>}
                >
                  <RecordEditor
                    inline
                    text={editor.text}
                    title={`${t("add")} · L${editor.line}`}
                    onClose={() => setEditor(null)}
                    onApply={(text) =>
                      applyEdit({
                        kind: "insert",
                        line: editor.line,
                        text,
                      })
                    }
                  />
                </Suspense>
              </div>
            )}
            {changed && (
              <div className="notice">
                <AlertCircle size={15} />
                {t("changed")}
                <button onClick={() => info.path && void openPath(info.path)}>
                  {t("reload")}
                </button>
              </div>
            )}
            {error && (
              <div className="notice error-notice" role="alert">
                <AlertCircle size={15} />
                {error}
                <button aria-label={t("close")} onClick={() => setError("")}>
                  <X size={14} />
                </button>
              </div>
            )}
            {documentDraftOpen ? (
              <main className="document-draft-pane">
                <section
                  className="document-draft-card"
                  aria-labelledby="document-draft-title"
                >
                  <header>
                    <div>
                      <FilePlus2 size={19} />
                      <div>
                        <h2 id="document-draft-title">{t("newFileTitle")}</h2>
                        <p>{t("newFileText")}</p>
                      </div>
                    </div>
                    <button
                      className="button"
                      disabled={!documentDraft}
                      onClick={() => void copy(documentDraft)}
                    >
                      <Copy size={14} />
                      {t("copyDraft")}
                    </button>
                  </header>
                  <textarea
                    autoFocus
                    aria-label={t("documentJsonl")}
                    spellCheck={false}
                    value={documentDraft}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (
                        new TextEncoder().encode(next).length >
                        MAX_DOCUMENT_DRAFT
                      ) {
                        setError(t("draftTooLarge"));
                        return;
                      }
                      setError("");
                      setDocumentDraft(next);
                    }}
                    placeholder={
                      '{"id": 1, "message": "Hello"}\n{"id": 2, "message": "你好"}'
                    }
                  />
                  <footer>
                    <span>
                      {sizeLabel(
                        new TextEncoder().encode(documentDraft).length,
                      )}{" "}
                      / 8 MiB · {t("local")}
                    </span>
                    <button
                      className="button primary"
                      disabled={busy}
                      onClick={() => void importData(documentDraft, false)}
                    >
                      <Check size={14} />
                      {busy ? t("loading") : t("apply")}
                    </button>
                  </footer>
                </section>
              </main>
            ) : (
              <main className="reader" ref={scroll} aria-busy={busy}>
                {busy && !editor ? (
                  <div className="loading">
                    <LoaderCircle size={22} className="spin" />
                    {t("loading")}
                  </div>
                ) : !records.length ? (
                  <div className="empty-records">{t("noRecords")}</div>
                ) : mode === "source" ? (
                  <div className="source-panel">
                    {records.some((record) => record.truncated) && (
                      <div className="source-limit-notice">
                        <AlertCircle size={14} />
                        {t("sourcePreviewLimited")}
                      </div>
                    )}
                    <button
                      className="source-copy"
                      onClick={() =>
                        void copy(records.map((r) => r.source).join(""))
                      }
                    >
                      <Copy size={14} />
                      {t("copySource")}
                    </button>
                    <pre>
                      <HighlightText
                        text={records.map((r) => r.source).join("")}
                        query={query}
                      />
                    </pre>
                  </div>
                ) : (
                  <div
                    style={{
                      height: virtual.getTotalSize(),
                      position: "relative",
                      width: "100%",
                    }}
                  >
                    {virtual.getVirtualItems().map((item) => (
                      <div
                        key={`${item.key}:${treeVersion}`}
                        data-index={item.index}
                        ref={virtual.measureElement}
                        className="virtual-record"
                        style={{ transform: `translateY(${item.start}px)` }}
                      >
                        <RecordCard
                          record={records[item.index]}
                          mode={mode}
                          treeState={stateFor(records[item.index].line)}
                          depth={depth}
                          copy={(text) => void copy(text)}
                          disabled={busy || changed || Boolean(editor)}
                          query={query}
                          fontScale={fontScale / 100}
                          inlineEditor={
                            editor &&
                            !editor.insert &&
                            editor.line === records[item.index].line ? (
                              <Suspense
                                fallback={
                                  <div className="loading">{t("loading")}</div>
                                }
                              >
                                <RecordEditor
                                  inline
                                  text={editor.text}
                                  title={`${t("edit")} · L${editor.line}`}
                                  onClose={() => setEditor(null)}
                                  onApply={(text) =>
                                    applyEdit({
                                      kind: "replace",
                                      line: editor.line,
                                      text,
                                    })
                                  }
                                />
                              </Suspense>
                            ) : undefined
                          }
                          lazyTree={
                            records[item.index].truncated ? (
                              <LazyJsonTree
                                line={records[item.index].line}
                                state={stateFor(records[item.index].line)}
                                defaultDepth={depth}
                                copy={(text) => void copy(text)}
                                search={(text) => {
                                  setQuery(text);
                                  setSearchOpen(true);
                                  searchInput.current?.focus();
                                }}
                                query={query}
                                fontScale={fontScale / 100}
                              />
                            ) : undefined
                          }
                          search={(text) => {
                            setQuery(text);
                            setSearchOpen(true);
                            searchInput.current?.focus();
                          }}
                          edit={() => {
                            const record = records[item.index];
                            let text = record.raw;
                            try {
                              text = pretty(parseTree(text));
                            } catch {
                              /* repair malformed record */
                            }
                            setEditor({
                              line: record.line,
                              text,
                              insert: false,
                            });
                          }}
                          duplicate={() =>
                            void applyEdit({
                              kind: "duplicate",
                              line: records[item.index].line,
                            }).catch((e) => setError(String(e)))
                          }
                          remove={() => {
                            const line = records[item.index].line;
                            void (
                              desktop
                                ? confirm(t("deleteConfirm"), {
                                    title: "JSONL Studio",
                                    kind: "warning",
                                  })
                                : Promise.resolve(
                                    window.confirm(t("deleteConfirm")),
                                  )
                            )
                              .then((ok) => {
                                if (ok)
                                  return applyEdit({ kind: "delete", line });
                              })
                              .catch((e) => setError(String(e)));
                          }}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </main>
            )}
            <footer className="statusbar">
              <span>
                <span className="status-dot" />
                {t("range")}{" "}
                {page.records.length
                  ? `${start.toLocaleString()}–${(page.nextLine - 1).toLocaleString()}`
                  : "0"}{" "}
                / {info.totalLines.toLocaleString()}
              </span>
              <span>
                {quantity === "all" ||
                quantity === "custom" ||
                (page.records.length < count && page.hasMore)
                  ? t("bounded")
                  : `${t("readOnly")} · ${info.encoding}`}
              </span>
            </footer>
          </section>
          {searchOpen && (
            <aside className="search-results" aria-label={t("searchResults")}>
              <header className="sidebar-header">
                <span>
                  <Search size={15} />
                  {t("searchResults")}
                </span>
                <button
                  className="icon-button"
                  aria-label={t("close")}
                  onClick={() => setSearchOpen(false)}
                >
                  <X size={14} />
                </button>
              </header>
              <div className="search-summary">
                {query
                  ? searching
                    ? t("searching")
                    : `${hits.length} ${t("matches")}`
                  : t("searchHint")}
                {query && (
                  <span>
                    {searchScanned.toLocaleString()} /{" "}
                    {info.totalLines.toLocaleString()} · max 500
                  </span>
                )}
              </div>
              <div className="search-result-list">
                {!query ? (
                  <div className="sidebar-empty">{t("searchHint")}</div>
                ) : !searching && !hits.length ? (
                  <div className="sidebar-empty">{t("noMatches")}</div>
                ) : (
                  hits.map((hit, index) => (
                    <button
                      className={activeHit === index ? "active" : ""}
                      key={`${hit.line}:${hit.pointer}:${index}`}
                      onClick={() => {
                        setActiveHit(index);
                        void jumpHit(hit);
                      }}
                    >
                      <span className="search-result-meta">
                        <strong>L{hit.line}</strong>
                        <code>{hit.pointer || "$"}</code>
                      </span>
                      <span className="search-preview">
                        <HighlightText text={hit.preview} query={query} />
                      </span>
                    </button>
                  ))
                )}
              </div>
            </aside>
          )}
        </div>
      ) : (
        <>
          {error && (
            <div className="notice error-notice" role="alert">
              {error}
            </div>
          )}
          <main className="welcome">
            <div className="welcome-mark">
              <Braces size={46} strokeWidth={1.4} />
              <span className="mark-line" />
            </div>
            <span className="eyebrow">YOUR DATA. YOUR DESKTOP.</span>
            <h1>{t("emptyTitle")}</h1>
            <p className="welcome-description">{t("emptyText")}</p>
            <div className="drop-zone">
              <FileJson2 size={27} strokeWidth={1.4} />
              <strong>{t("drop")}</strong>
              <span>
                .jsonl <span className="dot-separator">·</span> .ndjson
              </span>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void openFile()}
              >
                <FolderOpen size={16} />
                {t("open")}
                <kbd>{isMac ? "⌘" : "Ctrl+"}O</kbd>
              </button>
            </div>
            <div className="welcome-actions">
              <button onClick={() => void createDocument()}>
                <FilePlus2 size={15} />
                {t("new")}
              </button>
              <span>·</span>
              <button onClick={() => void importData(sample)}>
                {t("sample")}
                <ChevronRight size={13} />
              </button>
            </div>
            <div className="welcome-footer">
              <ShieldCheck size={14} />
              {t("local")}
              <span>UTF-8</span>
              <span>JSONL / NDJSON</span>
            </div>
          </main>
          <footer className="statusbar">
            <span>{t("readOnly")}</span>
            <span>JSONL Studio {packageInfo.version}</span>
          </footer>
        </>
      )}
      {recoverable && (
        <div className="notice recovery-notice">
          {t("recovery")}
          <button
            onClick={() =>
              void invoke<Info>("restore_document")
                .then(install)
                .then(() => setRecoverable(false))
                .catch((e) => setError(String(e)))
            }
          >
            {t("restore")}
          </button>
          <button
            onClick={() =>
              void invoke("discard_recovery")
                .then(() => setRecoverable(false))
                .catch((e) => setError(String(e)))
            }
          >
            {t("discard")}
          </button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          {toast}
        </div>
      )}
    </div>
  );
}
