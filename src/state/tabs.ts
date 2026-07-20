import { create } from "zustand";
import * as backend from "../lib/backend";
import { isVirtual, parentVirtual, routeTransfer } from "../lib/apath";
import { normalizePath, parentOf, sortEntries } from "../lib/fsutil";
import { t } from "../lib/i18n";
import {
  allTags,
  forgetPaths,
  loadTags,
  retagPath,
  saveTags,
  setTagOn,
  tagsOf,
  type TagMap,
} from "../lib/tags";
import type {
  ClipboardState,
  Drive,
  Entry,
  Favorite,
  KnownFolder,
  Pane,
  RunningOp,
  SearchState,
  SortBy,
  SortDir,
  Tab,
  ViewMode,
} from "../lib/types";
import { useUi } from "./ui";

/**
 * Estado central: abas, sidebar, clipboard, busca e operações.
 *
 * # Painel duplo (v0.5)
 *
 * Cada aba pertence a um PAINEL (`tab.pane`, 0 ou 1). O painel 1 só aparece
 * quando `dual` está ligado, mas as abas dele existem o tempo todo — assim
 * ligar e desligar o painel duplo não perde o lugar onde a pessoa estava.
 *
 * A escolha de desenho que fez o resto ficar simples: `activeTab()` continua
 * devolvendo UMA aba (a do painel com foco). Todo o código que já existia —
 * atalhos, menu de contexto, barra de status, renomear — continuou funcionando
 * sem saber que painel duplo existe. O que precisou saber foi só o que É de
 * painel: a lista (que recebe `pane` por prop), a barra de abas e as ações de
 * copiar/mover pro outro lado.
 *
 * # Zip inline (v0.5)
 *
 * Um caminho pode ser de disco (`C:\x`) ou VIRTUAL (`C:\x\a.zip::docs`). O
 * `navigate` decide qual comando chamar, e o `startOp` roteia a transferência
 * entre quatro combinações (disco→disco, zip→disco, disco→zip, zip→zip).
 *
 * Visão/ordenação são GLOBAIS (persistidas) — trocar numa aba vale pra todas.
 */

const VIEW_KEY = "localfiles.view";
const SORT_KEY = "localfiles.sort";
const FAV_KEY = "localfiles.favorites";
const DUAL_KEY = "localfiles.dual";

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
  /** Aba ativa de CADA painel (índice = painel). */
  activeIds: [number, number];
  activePane: Pane;
  /** Painel duplo ligado? (persistido) */
  dual: boolean;
  view: ViewMode;
  sortBy: SortBy;
  sortDir: SortDir;
  drives: Drive[];
  places: KnownFolder[];
  favorites: Favorite[];
  tags: TagMap;
  /** Só mostra itens com esta etiqueta (null = sem filtro). */
  tagFilter: string | null;
  clipboard: ClipboardState | null;
  ops: RunningOp[];
  search: SearchState | null;
  renaming: string | null;

  /** Aba ativa do painel com foco (o que o código antigo sempre chamou). */
  activeTab: () => Tab;
  /** Aba ativa de um painel específico. */
  paneTab: (pane: Pane) => Tab;
  /** Abas de um painel, na ordem. */
  paneTabs: (pane: Pane) => Tab[];
  /** O que a lista mostra: busca OU entradas da aba, já filtrado por etiqueta.
   *  Usado pelos atalhos de teclado e pelo menu de contexto (via `getState`).
   *  A LISTA não usa isto: um seletor que devolve array novo a cada chamada
   *  faz o zustand v5 re-renderizar em looping — lá o filtro é `useMemo`. */
  visibleEntries: () => Entry[];

  loadSidebar: () => Promise<void>;
  navigate: (path: string, opts?: { pushHistory?: boolean; pane?: Pane }) => Promise<void>;
  refresh: (opts?: { silent?: boolean; pane?: Pane }) => Promise<void>;
  goBack: () => void;
  goForward: () => void;
  goUp: () => void;
  newTab: (path?: string) => void;
  closeTab: (id: number) => void;
  setActiveTab: (id: number) => void;
  setActivePane: (pane: Pane) => void;
  toggleDual: () => void;
  /** Alterna o foco entre os painéis (Tab). */
  swapPane: () => void;
  setView: (v: ViewMode) => void;
  setSort: (by: SortBy) => void;
  setSelection: (paths: string[], anchor?: number | null, focus?: number | null) => void;
  setClipboard: (c: ClipboardState | null) => void;
  setRenaming: (path: string | null) => void;
  startOp: (sources: string[], destDir: string, isMove: boolean) => Promise<void>;
  /** Copia/move a seleção do painel com foco pro outro painel. */
  transferToOtherPane: (isMove: boolean) => Promise<void>;
  opProgress: (opId: number, p: RunningOp["progress"]) => void;
  opDone: (opId: number) => void;
  startSearch: (query: string, inContent: boolean) => Promise<void>;
  appendSearchResults: (opId: number, entries: Entry[]) => void;
  finishSearch: (opId: number, truncated: boolean) => void;
  clearSearch: () => void;
  isFavorite: (path: string) => boolean;
  toggleFavorite: (path: string) => void;
  tagsFor: (path: string) => string[];
  knownTags: () => { tag: string; count: number }[];
  applyTag: (paths: string[], tag: string, on: boolean) => void;
  setTagFilter: (tag: string | null) => void;
  /** Renomear/mover dentro do app: a etiqueta vai junto. */
  movedTags: (from: string, to: string) => void;
  forgetTags: (paths: string[]) => void;
}

let nextTabId = 1;

function makeTab(path: string, pane: Pane): Tab {
  return {
    id: nextTabId++,
    pane,
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

/** Observa a pasta (melhor-esforço; dentro de zip não há o que observar). */
function watch(path: string) {
  if (!backend.isTauri || isVirtual(path)) return;
  void backend.watchDir(path).catch(() => {
    /* pasta pode ter sumido entre navegar e observar */
  });
}

export const useFiles = create<FilesState>((set, get) => {
  /** Lista um caminho (de disco ou de dentro de um arquivo) numa aba. */
  async function listInto(tabId: number, path: string, silent = false) {
    const showHidden = useUi.getState().showHidden;
    try {
      const raw = isVirtual(path)
        ? await backend.archiveList(path)
        : await backend.listDir(path, showHidden);
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

  /** Normaliza destino: caminho virtual não passa pelo normalizePath do disco. */
  function normAny(path: string): string {
    return isVirtual(path) ? path : normalizePath(path);
  }

  return {
    tabs: [makeTab(FALLBACK_DIR, 0), makeTab(FALLBACK_DIR, 1)],
    activeIds: [1, 2],
    activePane: 0,
    dual: localStorage.getItem(DUAL_KEY) === "1",
    view: loadView(),
    sortBy: loadSort().by,
    sortDir: loadSort().dir,
    drives: [],
    places: [],
    favorites: loadFavorites(),
    tags: loadTags(),
    tagFilter: null,
    clipboard: null,
    ops: [],
    search: null,
    renaming: null,

    activeTab: () => get().paneTab(get().activePane),

    paneTab: (pane) => {
      const s = get();
      return (
        s.tabs.find((tb) => tb.id === s.activeIds[pane]) ??
        s.tabs.find((tb) => tb.pane === pane) ??
        s.tabs[0]
      );
    },

    paneTabs: (pane) => get().tabs.filter((tb) => tb.pane === pane),

    visibleEntries: () => {
      const s = get();
      const raw = s.search ? s.search.results : s.activeTab().entries;
      return filterByTag(raw, s);
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
      const pane = opts?.pane ?? get().activePane;
      const p = normAny(path);
      get().clearSearch();
      const tab = get().paneTab(pane);
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
      const tab = get().paneTab(opts?.pane ?? get().activePane);
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
            ? { ...tb, histIndex: tb.histIndex - 1, path: target, loading: true, selection: [], anchor: null, focusIdx: null }
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
            ? { ...tb, histIndex: tb.histIndex + 1, path: target, loading: true, selection: [], anchor: null, focusIdx: null }
            : tb,
        ),
      }));
      watch(target);
      void listInto(tab.id, target);
    },

    goUp: () => {
      const cur = get().activeTab().path;
      // Dentro de um arquivo, subir da raiz SAI pro disco (não é beco sem saída).
      const parent = isVirtual(cur) ? parentVirtual(cur) : parentOf(cur);
      if (parent) void get().navigate(parent);
    },

    newTab: (path) => {
      get().clearSearch();
      const pane = get().activePane;
      const tab = makeTab(path ?? get().paneTab(pane).path, pane);
      set((s) => {
        const activeIds: [number, number] = [...s.activeIds];
        activeIds[pane] = tab.id;
        return { tabs: [...s.tabs, tab], activeIds };
      });
      watch(tab.path);
      void listInto(tab.id, tab.path);
    },

    closeTab: (id) => {
      const s = get();
      const alvo = s.tabs.find((tb) => tb.id === id);
      if (!alvo) return;
      const doPainel = s.tabs.filter((tb) => tb.pane === alvo.pane);
      if (doPainel.length <= 1) return; // a última aba do painel não fecha
      const idx = doPainel.findIndex((tb) => tb.id === id);
      const tabs = s.tabs.filter((tb) => tb.id !== id);
      const activeIds: [number, number] = [...s.activeIds];
      if (activeIds[alvo.pane] === id) {
        activeIds[alvo.pane] = doPainel[Math.max(0, idx - 1)].id;
      }
      set({ tabs, activeIds });
      const nova = tabs.find((tb) => tb.id === activeIds[alvo.pane]);
      if (nova) watch(nova.path);
    },

    setActiveTab: (id) => {
      const s = get();
      const alvo = s.tabs.find((tb) => tb.id === id);
      if (!alvo || s.activeIds[alvo.pane] === id) {
        if (alvo && s.activePane !== alvo.pane) set({ activePane: alvo.pane });
        return;
      }
      s.clearSearch();
      const activeIds: [number, number] = [...s.activeIds];
      activeIds[alvo.pane] = id;
      set({ activeIds, activePane: alvo.pane });
      watch(alvo.path);
      // Atualização silenciosa ao voltar pra aba (pode ter mudado por fora).
      void listInto(alvo.id, alvo.path, true);
    },

    setActivePane: (pane) => {
      if (get().activePane === pane) return;
      // Trocar de painel fecha a busca: ela pertence ao painel onde nasceu, e
      // deixá-la viva mostraria resultados de UMA pasta com a outra em foco.
      get().clearSearch();
      set({ activePane: pane });
      watch(get().paneTab(pane).path);
    },

    toggleDual: () => {
      const dual = !get().dual;
      localStorage.setItem(DUAL_KEY, dual ? "1" : "0");
      set({ dual });
      if (!dual && get().activePane === 1) {
        // Desligar com o foco no painel 1 deixaria o foco num painel invisível.
        get().setActivePane(0);
        return;
      }
      if (dual) {
        // Só agora o painel 1 aparece: carrega o que ele deveria estar mostrando.
        const outro = get().paneTab(1);
        if (outro.entries.length === 0) void listInto(outro.id, outro.path, true);
      }
    },

    swapPane: () => {
      if (!get().dual) return;
      get().setActivePane(get().activePane === 0 ? 1 : 0);
    },

    setView: (view) => {
      localStorage.setItem(VIEW_KEY, view);
      set({ view });
    },

    setSort: (by) => {
      const s = get();
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

    /**
     * Roteia a transferência conforme de onde vem e pra onde vai. Quatro
     * combinações, e três delas existem:
     *
     * | origem | destino | o que acontece                  |
     * |--------|---------|---------------------------------|
     * | disco  | disco   | copiar/mover normal             |
     * | zip    | disco   | EXTRAIR                         |
     * | disco  | zip     | ADICIONAR (só zip gravável)     |
     * | zip    | zip     | recusado com aviso claro        |
     *
     * O último caso é recusado de propósito em vez de fingir: mover de um
     * arquivo pro outro exigiria extrair pra um temporário e re-adicionar, e
     * uma falha no meio deixaria o item em lugar nenhum.
     */
    startOp: async (sources, destDir, isMove) => {
      const ui = useUi.getState();
      if (sources.length === 0) return;
      const rota = routeTransfer(sources, destDir);

      try {
        switch (rota.kind) {
          case "refused":
            ui.pushToast(
              "error",
              t(
                rota.reason === "zipToZip"
                  ? "arch.noZipToZip"
                  : rota.reason === "readOnly"
                    ? "arch.readOnly"
                    : "arch.mixedSources",
              ),
            );
            return;

          case "extract": {
            // Tirar de dentro do arquivo é COPIAR: apagar de dentro do zip é
            // trabalho do LocalZip, e o usuário precisa saber disso na hora.
            if (isMove) ui.pushToast("info", t("arch.moveOutIsCopy"));
            const opId = await backend.archiveExtract(rota.archive, rota.inners, destDir);
            set((s) => ({
              ops: [...s.ops, { opId, isMove: false, kind: "extract", progress: null }],
            }));
            return;
          }

          case "add": {
            if (isMove) ui.pushToast("info", t("arch.moveInIsCopy"));
            const opId = await backend.archiveAdd(rota.archive, sources, rota.innerDir);
            set((s) => ({ ops: [...s.ops, { opId, isMove: false, kind: "add", progress: null }] }));
            return;
          }

          case "transfer": {
            const opId = await backend.startTransfer(sources, destDir, isMove);
            set((s) => ({ ops: [...s.ops, { opId, isMove, kind: "transfer", progress: null }] }));
            return;
          }
        }
      } catch (e) {
        ui.pushToast("error", t("toast.opFailed", { error: String(e) }));
      }
    },

    transferToOtherPane: async (isMove) => {
      const s = get();
      if (!s.dual) return;
      const origem = s.activeTab();
      const destino = s.paneTab(s.activePane === 0 ? 1 : 0);
      const sel = origem.selection;
      if (sel.length === 0) {
        useUi.getState().pushToast("info", t("pane.nothingSelected"));
        return;
      }
      if (destino.path === origem.path) {
        useUi.getState().pushToast("info", t("pane.samePlace"));
        return;
      }
      await s.startOp(sel, destino.path, isMove);
    },

    opProgress: (opId, progress) =>
      set((s) => ({ ops: s.ops.map((o) => (o.opId === opId ? { ...o, progress } : o)) })),

    opDone: (opId) => set((s) => ({ ops: s.ops.filter((o) => o.opId !== opId) })),

    startSearch: async (query, inContent) => {
      const prev = get().search;
      if (prev) void backend.cancelOp(prev.opId).catch(() => {});
      const root = get().activeTab().path;
      if (isVirtual(root)) {
        // A busca recursiva é do disco; dentro de um arquivo não existe.
        useUi.getState().pushToast("info", t("arch.noSearch"));
        return;
      }
      const showHidden = useUi.getState().showHidden;
      const opId = backend.newSearchOpId();
      set({ search: { root, query, inContent, running: true, opId, results: [], truncated: false } });
      try {
        await backend.startSearch(opId, root, query, inContent, showHidden);
      } catch (e) {
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

    tagsFor: (path) => tagsOf(get().tags, path),
    knownTags: () => allTags(get().tags),

    applyTag: (paths, tag, on) => {
      const tags = setTagOn(get().tags, paths, tag, on);
      saveTags(tags);
      set({ tags });
    },

    setTagFilter: (tagFilter) => set({ tagFilter }),

    movedTags: (from, to) => {
      const tags = retagPath(get().tags, from, to);
      if (tags !== get().tags) {
        saveTags(tags);
        set({ tags });
      }
    },

    forgetTags: (paths) => {
      const tags = forgetPaths(get().tags, paths);
      if (tags !== get().tags) {
        saveTags(tags);
        set({ tags });
      }
    },
  };
});

/**
 * Aplica o filtro de etiqueta. PASTAS passam sempre: esconder a pasta que
 * contém os arquivos etiquetados deixaria o filtro sem como navegar.
 */
function filterByTag(entries: Entry[], s: { tagFilter: string | null; tags: TagMap }): Entry[] {
  if (!s.tagFilter) return entries;
  const alvo = s.tagFilter;
  return entries.filter((e) => e.isDir || tagsOf(s.tags, e.path).includes(alvo));
}

/** Entradas visíveis da aba ativa (já ordenadas na carga). */
export function selectEntries(s: FilesState): Entry[] {
  return s.activeTab().entries;
}
