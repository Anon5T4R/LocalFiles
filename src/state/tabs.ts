import { create } from "zustand";
import * as backend from "../lib/backend";
import { normalizePath, parentOf, sortEntries } from "../lib/fsutil";
import { t } from "../lib/i18n";
import type {
  ClipboardState,
  Drive,
  Entry,
  KnownFolder,
  RunningOp,
  SortBy,
  SortDir,
  Tab,
  ViewMode,
} from "../lib/types";
import { useUi } from "./ui";

/**
 * Estado central: abas (cada uma com caminho, histórico e seleção), sidebar
 * (locais + unidades), clipboard interno e operações em andamento.
 *
 * Visão/ordenação são GLOBAIS (persistidas) — trocar numa aba vale pra todas,
 * como o João prefere nos apps da suíte (config única, sem surpresa por aba).
 */

const VIEW_KEY = "localfiles.view";
const SORT_KEY = "localfiles.sort";

function loadView(): ViewMode {
  const v = localStorage.getItem(VIEW_KEY);
  return v === "list" || v === "grid" ? v : "details";
}

function loadSort(): { by: SortBy; dir: SortDir } {
  try {
    const raw = localStorage.getItem(SORT_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      const by = ["name", "size", "modified", "type"].includes(p.by) ? p.by : "name";
      const dir = p.dir === "desc" ? "desc" : "asc";
      return { by, dir };
    }
  } catch {
    /* valor corrompido: ignora */
  }
  return { by: "name", dir: "asc" };
}

interface FilesState {
  tabs: Tab[];
  activeTabId: number;
  view: ViewMode;
  sortBy: SortBy;
  sortDir: SortDir;
  drives: Drive[];
  places: KnownFolder[];
  clipboard: ClipboardState | null;
  ops: RunningOp[];
  /** Caminho em modo edição de renome inline (na lista). */
  renaming: string | null;

  activeTab: () => Tab;
  loadSidebar: () => Promise<void>;
  navigate: (path: string, opts?: { pushHistory?: boolean }) => Promise<void>;
  refresh: () => Promise<void>;
  goBack: () => void;
  goForward: () => void;
  goUp: () => void;
  newTab: (path?: string) => void;
  closeTab: (id: number) => void;
  setActiveTab: (id: number) => void;
  setView: (v: ViewMode) => void;
  setSort: (by: SortBy) => void;
  setSelection: (paths: string[], anchor?: number | null) => void;
  setClipboard: (c: ClipboardState | null) => void;
  setRenaming: (path: string | null) => void;
  startOp: (sources: string[], destDir: string, isMove: boolean) => Promise<void>;
  opProgress: (opId: number, p: RunningOp["progress"]) => void;
  opDone: (opId: number) => void;
}

let nextTabId = 1;

function makeTab(path: string): Tab {
  return {
    id: nextTabId++,
    path,
    history: [path],
    histIndex: 0,
    entries: [],
    loading: true,
    error: null,
    selection: [],
    anchor: null,
  };
}

/** Home padrão pro boot (sobrescrito pelo get_startup_dir no App). */
export const FALLBACK_DIR = "C:\\";

export const useFiles = create<FilesState>((set, get) => {
  async function listInto(tabId: number, path: string) {
    const showHidden = useUi.getState().showHidden;
    try {
      const raw = await backend.listDir(path, showHidden);
      const { sortBy, sortDir } = get();
      set((s) => ({
        tabs: s.tabs.map((tb) =>
          tb.id === tabId
            ? { ...tb, entries: sortEntries(raw, sortBy, sortDir), loading: false, error: null }
            : tb,
        ),
      }));
    } catch (e) {
      set((s) => ({
        tabs: s.tabs.map((tb) =>
          tb.id === tabId ? { ...tb, entries: [], loading: false, error: String(e) } : tb,
        ),
      }));
    }
  }

  return {
    tabs: [makeTab(FALLBACK_DIR)],
    activeTabId: 1,
    view: loadView(),
    sortBy: loadSort().by,
    sortDir: loadSort().dir,
    drives: [],
    places: [],
    clipboard: null,
    ops: [],
    renaming: null,

    activeTab: () => {
      const s = get();
      return s.tabs.find((tb) => tb.id === s.activeTabId) ?? s.tabs[0];
    },

    loadSidebar: async () => {
      const [drives, places] = await Promise.all([
        backend.listDrives().catch(() => [] as Drive[]),
        backend.knownFolders().catch(() => [] as KnownFolder[]),
      ]);
      set({ drives, places });
    },

    navigate: async (path, opts) => {
      const push = opts?.pushHistory !== false;
      const p = normalizePath(path);
      const tab = get().activeTab();
      set((s) => ({
        tabs: s.tabs.map((tb) => {
          if (tb.id !== tab.id) return tb;
          const history = push
            ? [...tb.history.slice(0, tb.histIndex + 1), p]
            : tb.history.map((h, i) => (i === tb.histIndex ? p : h));
          return {
            ...tb,
            path: p,
            history,
            histIndex: push ? history.length - 1 : tb.histIndex,
            loading: true,
            selection: [],
            anchor: null,
          };
        }),
        renaming: null,
      }));
      await listInto(tab.id, p);
    },

    refresh: async () => {
      const tab = get().activeTab();
      set((s) => ({
        tabs: s.tabs.map((tb) => (tb.id === tab.id ? { ...tb, loading: true } : tb)),
      }));
      await listInto(tab.id, tab.path);
    },

    goBack: () => {
      const tab = get().activeTab();
      if (tab.histIndex <= 0) return;
      const target = tab.history[tab.histIndex - 1];
      set((s) => ({
        tabs: s.tabs.map((tb) =>
          tb.id === tab.id
            ? { ...tb, histIndex: tb.histIndex - 1, path: target, loading: true, selection: [] }
            : tb,
        ),
      }));
      void listInto(tab.id, target);
    },

    goForward: () => {
      const tab = get().activeTab();
      if (tab.histIndex >= tab.history.length - 1) return;
      const target = tab.history[tab.histIndex + 1];
      set((s) => ({
        tabs: s.tabs.map((tb) =>
          tb.id === tab.id
            ? { ...tb, histIndex: tb.histIndex + 1, path: target, loading: true, selection: [] }
            : tb,
        ),
      }));
      void listInto(tab.id, target);
    },

    goUp: () => {
      const parent = parentOf(get().activeTab().path);
      if (parent) void get().navigate(parent);
    },

    newTab: (path) => {
      const tab = makeTab(path ?? get().activeTab().path);
      set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
      void listInto(tab.id, tab.path);
    },

    closeTab: (id) => {
      const s = get();
      if (s.tabs.length <= 1) return; // a última aba não fecha
      const idx = s.tabs.findIndex((tb) => tb.id === id);
      const tabs = s.tabs.filter((tb) => tb.id !== id);
      const activeTabId =
        s.activeTabId === id ? tabs[Math.max(0, idx - 1)].id : s.activeTabId;
      set({ tabs, activeTabId });
    },

    setActiveTab: (id) => set({ activeTabId: id }),

    setView: (view) => {
      localStorage.setItem(VIEW_KEY, view);
      set({ view });
    },

    setSort: (by) => {
      const s = get();
      // Clicar de novo na mesma coluna inverte a direção.
      const dir: SortDir = s.sortBy === by && s.sortDir === "asc" ? "desc" : "asc";
      localStorage.setItem(SORT_KEY, JSON.stringify({ by, dir }));
      set({
        sortBy: by,
        sortDir: dir,
        tabs: s.tabs.map((tb) => ({ ...tb, entries: sortEntries(tb.entries, by, dir) })),
      });
    },

    setSelection: (paths, anchor) => {
      const tab = get().activeTab();
      set((s) => ({
        tabs: s.tabs.map((tb) =>
          tb.id === tab.id
            ? { ...tb, selection: paths, anchor: anchor === undefined ? tb.anchor : anchor }
            : tb,
        ),
      }));
    },

    setClipboard: (clipboard) => set({ clipboard }),
    setRenaming: (renaming) => set({ renaming }),

    startOp: async (sources, destDir, isMove) => {
      try {
        const opId = await backend.startTransfer(sources, destDir, isMove);
        set((s) => ({ ops: [...s.ops, { opId, isMove, progress: null }] }));
      } catch (e) {
        useUi.getState().pushToast("error", t("toast.opFailed", { error: String(e) }));
      }
    },

    opProgress: (opId, progress) =>
      set((s) => ({
        ops: s.ops.map((o) => (o.opId === opId ? { ...o, progress } : o)),
      })),

    opDone: (opId) => set((s) => ({ ops: s.ops.filter((o) => o.opId !== opId) })),
  };
});

/** Entradas visíveis da aba ativa (já ordenadas na carga). */
export function selectEntries(s: FilesState): Entry[] {
  const tab = s.tabs.find((tb) => tb.id === s.activeTabId) ?? s.tabs[0];
  return tab.entries;
}
