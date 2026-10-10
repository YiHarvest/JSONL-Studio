import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
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
  ClipboardPaste,
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
  PanelTop,
  AlertCircle,
  LoaderCircle,
  Save,
  Plus,
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
import type { TreeState } from "./components/tree/JsonTree";
import i18n, { systemLanguage } from "./i18n";
import { sample } from "./sample";
import packageInfo from "../package.json";

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
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [query, setQuery] = useState("");
  const [match, setMatch] = useState(0);
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
  const [depth, setDepth] = useState(2);
  const [treeVersion, setTreeVersion] = useState(0);
  const [toast, setToast] = useState("");
  const [language, setLanguage] = useState(
    localStorage.getItem("language") ?? "system",
  );
  const [theme, setTheme] = useState(localStorage.getItem("theme") ?? "system");
  const states = useRef(new Map<number, TreeState>());
  const scroll = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const jumpInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const history = useRef<number[]>([]);
  const infoRef = useRef(info);
  infoRef.current = info;
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
      setMatch(0);
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
      !infoRef.current?.dirty ||
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
    async (text: string) => {
      if (busyRef.current || !(await allowReplace())) return;
      setBusy(true);
      setError("");
      try {
        await install(await importText(text));
        setPasteOpen(false);
        setPaste("");
      } catch (e) {
        setError(String(e));
        setBusy(false);
      }
    },
    [install, allowReplace],
  );
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
      setQuery("");
      history.current = [];
      setTreeVersion((v) => v + 1);
      await load(Math.max(1, Math.min(start, next.totalLines || 1)), count);
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
          void importData("");
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
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [openFile, importData, saveDocument]);

  const records = useMemo(
    () =>
      page.records.filter(
        (r) => !query || r.raw.toLowerCase().includes(query.toLowerCase()),
      ),
    [page, query],
  );
  const jumpHit = async (hit: SearchHit) => {
    setQuery("");
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
  const runSearch = async () => {
    if (!query.trim() || !info) return;
    const token = ++searchToken.current;
    const text = query;
    setSearching(true);
    setHits([]);
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
  };
  const virtual = useVirtualizer({
    count: records.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => (mode === "tree" ? 240 : 160),
    overscan: 3,
    getItemKey: (index) => records[index].line,
  });
  useEffect(() => {
    virtual.measure();
  }, [mode, depth, treeVersion, virtual]);
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
  const isMac = navigator.userAgent.includes("Mac");
  return (
    <div className={`app ${isMac && desktop ? "mac" : ""}`}>
      <header className="titlebar" data-tauri-drag-region>
        <div className="brand" data-tauri-drag-region>
          <span className="brand-icon">
            <Braces size={19} strokeWidth={2.1} />
          </span>
          <span>JSONL Studio</span>
          <span className="version">EDITOR</span>
        </div>
        <div className="titlebar-center" data-tauri-drag-region>
          {info?.name ?? t("local")}
          {info?.dirty && <span className="dirty-dot" title={t("unsaved")} />}
        </div>
        <div className="preferences">
          <label className="preference">
            <Languages size={15} />
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
          <label className="preference">
            <SunMoon size={15} />
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
      <div className="toolbar">
        <button
          className="toolbar-button primary-open"
          disabled={busy}
          onClick={() => void openFile()}
        >
          <FolderOpen size={17} />
          {t("open")}
          <kbd>{isMac ? "⌘" : "Ctrl+"}O</kbd>
        </button>
        <button
          className="toolbar-button"
          disabled={busy}
          onClick={() => void importData("")}
        >
          <FilePlus2 size={16} />
          {t("new")}
        </button>
        <button
          className="toolbar-button"
          disabled={busy}
          onClick={() => setPasteOpen(true)}
        >
          <ClipboardPaste size={16} />
          {t("paste")}
        </button>
        <span className="toolbar-divider" />
        <button
          className="toolbar-button"
          disabled={!info || busy || changed}
          onClick={() => void saveDocument()}
        >
          <Save size={16} />
          {t("save")}
        </button>
        <button
          className="toolbar-button"
          disabled={!info || busy || changed}
          onClick={() => void saveDocument(true)}
        >
          {t("saveAs")}
        </button>
        <div className="search-box">
          <Search size={15} />
          <input
            ref={searchInput}
            aria-label={t("search")}
            placeholder={t("search")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setMatch(0);
            }}
          />
          {query && (
            <>
              <span className="match-count">{records.length}</span>
              <button
                className="icon-button"
                aria-label={t("findNext")}
                onClick={() => {
                  if (records.length) {
                    const next = (match + 1) % records.length;
                    setMatch(next);
                    virtual.scrollToIndex(next);
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
          aria-label={t("searchMode")}
          value={searchMode}
          onChange={(e) => setSearchMode(e.target.value)}
        >
          <option value="raw">{t("rawSearch")}</option>
          <option value="key">{t("keySearch")}</option>
          <option value="value">{t("valueSearch")}</option>
        </select>
        <button
          className="icon-button"
          aria-label={searching ? t("stop") : t("fileSearch")}
          disabled={!info || busy || !query}
          onClick={() => {
            if (searching) {
              searchToken.current++;
              setSearching(false);
            } else void runSearch();
          }}
        >
          {searching ? <X size={15} /> : <Search size={15} />}
        </button>
        <span className="privacy-badge">
          <ShieldCheck size={14} />
          {t("local")}
        </span>
      </div>
      {info ? (
        <>
          <section className="file-info">
            <div className="file-heading">
              <FileJson2 size={29} strokeWidth={1.4} />
              <div>
                <h1>
                  {info.name}
                  {info.dirty && (
                    <span className="unsaved-label">{t("unsaved")}</span>
                  )}
                </h1>
                <p title={info.path ?? ""}>{info.path ?? t("scratchNotice")}</p>
              </div>
            </div>
            <div className="file-facts">
              <div>
                <strong>{sizeLabel(info.size)}</strong>
                <span>
                  {info.encoding} · {info.newline}
                </span>
              </div>
              <div>
                <strong>
                  {info.totalLines.toLocaleString()} <small>{t("lines")}</small>
                </strong>
                <span>
                  {info.modified
                    ? `${t("modified")} ${new Date(info.modified * 1000).toLocaleString()}`
                    : "JSONL / NDJSON"}
                </span>
              </div>
              <div className="validation-fact">
                <strong>
                  <span className="valid-color">
                    {stats
                      ? stats[0].toLocaleString()
                      : page.records.length - visibleErrors}
                  </span>
                  <small> {t("valid")}</small>
                  <span
                    className={visibleErrors || stats?.[1] ? "error-color" : ""}
                  >
                    {" "}
                    · {stats ? stats[1].toLocaleString() : visibleErrors}
                  </span>
                  <small> {t("errors")}</small>
                </strong>
                <button
                  disabled={validating || busy || changed}
                  onClick={() => void validate()}
                >
                  {validating
                    ? t("validating")
                    : stats
                      ? `✓ ${t("validate")}`
                      : `${t("range")} · ${t("validate")}`}
                </button>
              </div>
            </div>
          </section>
          <div className="reader-controls">
            <button
              className="small-button"
              disabled={busy || changed}
              onClick={() =>
                setEditor({
                  line: info.totalLines + 1,
                  text: "{}",
                  insert: true,
                })
              }
            >
              <Plus size={13} />
              {t("add")}
            </button>
            <div className="segmented" aria-label="View mode">
              {(["tree", "pretty", "wrap", "raw", "source"] as ViewMode[]).map(
                (value) => (
                  <button
                    key={value}
                    aria-pressed={mode === value}
                    className={mode === value ? "active" : ""}
                    onClick={() => setMode(value)}
                  >
                    {value === "tree" && <Braces size={13} />}
                    {t(value)}
                  </button>
                ),
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
                  onBlur={() => {
                    if (info) void load(start, count);
                  }}
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
          {(hits.length > 0 || searching) && (
            <div className="search-results">
              <header>
                {searching ? t("searching") : `${hits.length} ${t("matches")}`}{" "}
                · {searchScanned.toLocaleString()} /{" "}
                {info.totalLines.toLocaleString()} · max 500
                <button
                  className="icon-button"
                  aria-label={t("close")}
                  onClick={() => {
                    searchToken.current++;
                    setSearching(false);
                    setHits([]);
                  }}
                >
                  <X size={13} />
                </button>
              </header>
              <div>
                {hits.map((hit, i) => (
                  <button key={i} onClick={() => void jumpHit(hit)}>
                    <strong>L{hit.line}</strong>
                    <code>{hit.pointer || "$"}</code>
                    <span>{hit.preview}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {mode === "tree" && (
            <div className="tree-tools">
              <span>
                <PanelTop size={12} />
                JSON TREE
              </span>
              <button onClick={() => setTreeDepth(129)}>{t("expand")}</button>
              <button onClick={() => setTreeDepth(0)}>{t("collapse")}</button>
              <span className="tools-divider" />
              {[1, 2, 3].map((n) => (
                <button
                  className={depth === n ? "selected-depth" : ""}
                  key={n}
                  onClick={() => setTreeDepth(n)}
                >
                  {t("depth")} {n}
                </button>
              ))}
              <span className="tree-hint">
                {isMac ? "Option" : "Alt"} + click ↳
              </span>
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
          <main className="reader" ref={scroll} aria-busy={busy}>
            {busy ? (
              <div className="loading">
                <LoaderCircle size={22} className="spin" />
                {t("loading")}
              </div>
            ) : !records.length ? (
              <div className="empty-records">
                {query ? t("noMatches") : t("noRecords")}
              </div>
            ) : mode === "source" ? (
              <div className="source-panel">
                <button
                  className="source-copy"
                  onClick={() =>
                    void copy(records.map((r) => r.source).join(""))
                  }
                >
                  <Copy size={14} />
                  {t("copySource")}
                </button>
                <pre>{records.map((r) => r.source).join("")}</pre>
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
                      disabled={busy || changed}
                      search={(text) => {
                        setQuery(text);
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
                        setEditor({ line: record.line, text, insert: false });
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
                            if (ok) return applyEdit({ kind: "delete", line });
                          })
                          .catch((e) => setError(String(e)));
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </main>
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
        </>
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
              <button onClick={() => setPasteOpen(true)}>
                <ClipboardPaste size={15} />
                {t("paste")}
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
      {editor && (
        <Suspense fallback={<div className="toast">{t("loading")}</div>}>
          <RecordEditor
            text={editor.text}
            title={`${t(editor.insert ? "add" : "edit")} · L${editor.line}`}
            onClose={() => setEditor(null)}
            onApply={(text) =>
              applyEdit({
                kind: editor.insert ? "insert" : "replace",
                line: editor.line,
                text,
              })
            }
          />
        </Suspense>
      )}
      {pasteOpen && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPasteOpen(false);
          }}
        >
          <section
            className="paste-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="paste-title"
            onKeyDown={(e) => {
              if (e.key === "Escape") setPasteOpen(false);
            }}
          >
            <header>
              <ClipboardPaste size={21} />
              <h2 id="paste-title">{t("pasteTitle")}</h2>
              <button
                className="icon-button"
                aria-label={t("close")}
                onClick={() => setPasteOpen(false)}
              >
                <X size={18} />
              </button>
            </header>
            <p>{t("pasteText")}</p>
            <textarea
              autoFocus
              aria-label={t("pasteText")}
              spellCheck={false}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={
                '{"id": 1, "message": "Hello"}\n{"id": 2, "message": "你好"}'
              }
            />
            <footer>
              <span>8 MiB max · {t("local")}</span>
              <button className="button" onClick={() => setPasteOpen(false)}>
                {t("cancel")}
              </button>
              <button
                className="button primary"
                disabled={busy || !paste.trim()}
                onClick={() => void importData(paste)}
              >
                {busy ? t("loading") : t("import")}
                <ChevronRight size={14} />
              </button>
            </footer>
          </section>
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
