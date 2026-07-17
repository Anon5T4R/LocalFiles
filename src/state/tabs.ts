import { create } from "zustand";
import * as backend from "../lib/backend";
import { normalizePath, parentOf, sortEntries } from "../lib/fsutil";
import { t } from "../lib/i18n";
import type {
  ClipboardState,
  Drive,
  Entry,
  Favorite,
  KnownFolder,
  RunningOp,
  SearchState,
  SortBy,
  SortDir,
  Tab,
  ViewMode,
} from "../lib/types";
import { useUi } from "./ui";

/**
 * Estado central: abas (cada uma com caminho, histórico e seleção), sidebar
 * (locais + unidades + favoritos), clipboard interno, busca ativa e
 * operações em andamento.
 *
 * Visão/ordenação são GLOBAIS (persistidas) — trocar numa aba vale pra todas,
 * como o João prefere nos apps da suíte (config única, sem surpresa por aba).
 */

const VIEW_KEY = "localfiles.view";
const SORT_KEY = "localfiles.sort";
const FAV_KEY = "localfiles.favorites";

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

function loadFavorites(): Favorite[] {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        return list.filter((f) => typeof f?.path === "string" && typeof f?.name === "string");
      }
    }
  } catch {
    /* ignora */
  }
  return [];
}

function saveFavorites(favs: Favorite[]) {
  localStorage.setItem(FAV_KEY, JSON.stringify(favs));
}

interface FilesState {
  tabs: Tab[];
  activeTabId: number;
  view: ViewMode;
  sortBy: SortBy;
  sortDir: SortDir;
  drives: Drive[];
  places: KnownFolder[];
  favorites: Favorite[];
  clipboard: ClipboardState | null;
  ops: RunningOp[];
  search: SearchState | null;
  /** Caminho em modo edição de renome inline (na lista). */
  renaming: string | null;

  activeTab: () => Tab;
  /** O que a lista mostra: resultados da busca OU as entradas da aba. */
  visibleEntries: () => Entry[];
  loadSidebar: () => Promise<void>;
  navigate: (path: string, opts?: { pushHistory?: boolean }) => Promise<void>;
  refresh: (opts?: { silent?: boolean }) => Promise<void>;
  goBack: () => void;
  goForward: () => void;
  goUp: () => void;
  newTab: (path?: string) => void;
  closeTab: (id: number) => void;
  setActiveTab: (id: number) => void;
  setView: (v: ViewMode) => void;
  setSort: (by: SortBy) => void;
  setSelection: (paths: string[], anchor?: number | null, focus?: number | null) => void;
  setClipboard: (c: ClipboardState | null) => void;
  setRenaming: (path: string | null) => void;
  startOp: (sources: string[], destDir: string, isMove: boolean) => Promise<void>;
  opProgress: (opId: number, p: RunningOp["progress"]) => void;
  opDone: (opId: number) => void;
  startSearch: (query: string, inContent: boolean) => Promise<void>;
  appendSearchResults: (opId: number, entries: Entry[]) => void;
  finishSearch: (opId: number, truncated: boolean) => void;
  clearSearch: () => void;
  isFavorite: (path: string) => boolean;
  toggleFavorite: (path: string) => void;
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
    focusIdx: null,
  };
}

/** Home padrão pro boot (sobrescrito pelo get_startup_dir no App). */
export const FALLBACK_DIR = "C:\\";

/** Observa a pasta (melhor-esforço; em navegador puro não existe a ponte). */
function watch(path: string) {
  if (!backend.isTauri) return;
  void backend.watchDir(path).catch(() => {
    /* pasta pode ter sumido entre navegar e observar */
  });
}

export const useFiles = create<FilesState>((set, get) => {
  async function listInto(tabId: number, path: string, silent = false) {
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
      if (silent) return; // refresh de watcher com pasta sumida: fica quieto
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
    favorites: loadFavorites(),
    clipboard: null,
    ops: [],
    search: null,
    renaming: null,

    activeTab: () => {
      const s = get();
      return s.tabs.find((tb) => tb.id === s.activeTabId) ?? s.tabs[0];
    },

    visibleEntries: () => {
      const s = get();
      return s.search ? s.search.results : s.activeTab().entries;
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
      get().clearSearch();
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
            focusIdx: null,
          };
        }),
        renaming: null,
      }));
      watch(p);
      await listInto(tab.id, p);
    },

    refresh: async (opts) => {
      const tab = get().activeTab();
      if (!opts?.silent) {
        set((s) => ({
          tabs: s.tabs.map((tb) => (tb.id === tab.id ? { ...tb, loading: true } : tb)),
        }));
      }
      await listInto(tab.id, tab.path, opts?.silent === true);
    },

    goBack: () => {
      const tab = get().activeTab();
      if (tab.histIndex <= 0) return;
      get().clearSearch();
      const target = tab.history[tab.histIndex - 1];
      set((s) => ({
        tabs: s.tabs.map((tb) =>
          tb.id === tab.id
            ? {
                ...tb,
                histIndex: tb.histIndex - 1,
                path: target,
                loading: true,
                selection: [],
                anchor: null,
                focusIdx: null,
              }
            : tb,
        ),
      }));
      watch(target);
      void listInto(tab.id, target);
    },

    goForward: () => {
      const tab = get().activeTab();
      if (tab.histIndex >= tab.history.length - 1) return;
      get().clearSearch();
      const target = tab.history[tab.histIndex + 1];
      set((s) => ({
        tabs: s.tabs.map((tb) =>
          tb.id === tab.id
            ? {
                ...tb,
                histIndex: tb.histIndex + 1,
                path: target,
                loading: true,
                selection: [],
                anchor: null,
                focusIdx: null,
              }
            : tb,
        ),
      }));
      watch(target);
      void listInto(tab.id, target);
    },

    goUp: () => {
      const parent = parentOf(get().activeTab().path);
      if (parent) void get().navigate(parent);
    },

    newTab: (path) => {
      get().clearSearch();
      const tab = makeTab(path ?? get().activeTab().path);
      set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
      watch(tab.path);
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
      if (s.activeTabId === id) {
        const active = tabs.find((tb) => tb.id === activeTabId);
        if (active) watch(active.path);
      }
    },

    setActiveTab: (id) => {
      if (id === get().activeTabId) return;
      get().clearSearch();
      set({ activeTabId: id });
      const tab = get().activeTab();
      watch(tab.path);
      // Atualização silenciosa ao voltar pra aba (pode ter mudado por fora).
      void listInto(tab.id, tab.path, true);
    },

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
        search: s.search ? { ...s.search, results: sortEntries(s.search.results, by, dir) } : null,
      });
    },

    setSelection: (paths, anchor, focus) => {
      const tab = get().activeTab();
      set((s) => ({
        tabs: s.tabs.map((tb) =>
          tb.id === tab.id
            ? {
                ...tb,
                selection: paths,
                anchor: anchor === undefined ? tb.anchor : anchor,
                focusIdx: focus === undefined ? tb.focusIdx : focus,
              }
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

    startSearch: async (query, inContent) => {
      const prev = get().search;
      if (prev) void backend.cancelOp(prev.opId).catch(() => {});
      const root = get().activeTab().path;
      const showHidden = useUi.getState().showHidden;
      // O opId nasce AQUI, síncrono, e vai como argumento pro Rust: o estado
      // já começa com o id certo e nenhum `search-result`/`search-done` que
      // chegue antes da promise do invoke resolver é descartado.
      const opId = backend.newSearchOpId();
      set({
        search: { root, query, inContent, running: true, opId, results: [], truncated: false },
      });
      try {
        await backend.startSearch(opId, root, query, inContent, showHidden);
      } catch (e) {
        // Só limpa se ainda for ESTA busca (outra pode ter começado enquanto isso).
        set((s) => (s.search?.opId === opId ? { search: null } : {}));
        useUi.getState().pushToast("error", String(e));
      }
    },

    appendSearchResults: (opId, entries) =>
      set((s) =>
        s.search && s.search.opId === opId
          ? { search: { ...s.search, results: [...s.search.results, ...entries] } }
          : {},
      ),

    finishSearch: (opId, truncated) =>
      set((s) =>
        s.search && s.search.opId === opId
          ? { search: { ...s.search, running: false, truncated } }
          : {},
      ),

    clearSearch: () => {
      const prev = get().search;
      if (!prev) return;
      void backend.cancelOp(prev.opId).catch(() => {});
      set({ search: null });
    },

    isFavorite: (path) => get().favorites.some((f) => f.path === path),

    toggleFavorite: (path) => {
      const s = get();
      const ui = useUi.getState();
      if (s.isFavorite(path)) {
        const favorites = s.favorites.filter((f) => f.path !== path);
        saveFavorites(favorites);
        set({ favorites });
        ui.pushToast("info", t("fav.removed"));
      } else {
        const name = path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() ?? path;
        const favorites = [...s.favorites, { name, path }];
        saveFavorites(favorites);
        set({ favorites });
        ui.pushToast("ok", t("fav.added", { name }));
      }
    },
  };
});

/** Entradas visíveis da aba ativa (já ordenadas na carga). */
export function selectEntries(s: FilesState): Entry[] {
  const tab = s.tabs.find((tb) => tb.id === s.activeTabId) ?? s.tabs[0];
  return tab.entries;
}
