import { useEffect, useMemo, useRef, useState } from "react";
import * as actions from "../lib/actions";
import { innerCrumbs, isVirtual, splitVirtual } from "../lib/apath";
import { KIND_ICON, breadcrumbOf, formatBytes, formatDate, kindOf, parentOf } from "../lib/fsutil";
import { localeTag, t } from "../lib/i18n";
import { getThumb } from "../lib/thumbs";
import type { Entry, Pane, SortBy } from "../lib/types";
import { useVirtual, useWidth } from "../lib/virtual";
import { useFiles } from "../state/tabs";
import { useUi } from "../state/ui";

/**
 * A área principal de UM painel: lista de arquivos nas 3 visões, VIRTUALIZADA,
 * com seleção, renomear inline (F2), drag-and-drop, menu de contexto,
 * miniaturas e modo "resultados de busca".
 *
 * Com painel duplo, este componente é montado DUAS vezes (`pane` 0 e 1). Tudo
 * que ele lê vem do painel dele — nunca do "ativo" — porque senão os dois lados
 * mostrariam a mesma coisa. O único lugar onde "ativo" importa é o clique:
 * mexer num painel dá foco a ele antes de qualquer outra coisa.
 */

const ROW_H = 28;
const HEAD_H = 29;
const CARD_W = 116; // largura mínima do card + gap
const CARD_H = 104;
const GRID_PAD = 10;

export default function FileList({ pane = 0 }: { pane?: Pane }) {
  const tab = useFiles((s) => s.paneTab(pane));
  const search = useFiles((s) => (s.activePane === pane ? s.search : null));
  const dual = useFiles((s) => s.dual);
  const activePane = useFiles((s) => s.activePane);
  const view = useFiles((s) => s.view);
  const sortBy = useFiles((s) => s.sortBy);
  const sortDir = useFiles((s) => s.sortDir);
  const renaming = useFiles((s) => s.renaming);
  const clipboard = useFiles((s) => s.clipboard);
  const tagFilter = useFiles((s) => s.tagFilter);
  const tags = useFiles((s) => s.tags);
  const setMenu = useUi((s) => s.setMenu);

  const focado = !dual || activePane === pane;
  // As entradas são DERIVADAS aqui, não num seletor do zustand. Um seletor que
  // devolve um array novo a cada chamada (o filtro de etiqueta devolve) faz o
  // `useSyncExternalStore` do zustand v5 achar que o estado mudou SEMPRE — o
  // componente re-renderiza em looping e o React reclama de "getSnapshot".
  const entries = useMemo(() => {
    const base = search ? search.results : tab.entries;
    if (!tagFilter) return base;
    // Pastas passam sempre: esconder a pasta que CONTÉM os itens etiquetados
    // deixaria o filtro sem como navegar.
    return base.filter((e) => e.isDir || (tags[tagKeyOf(e.path)] ?? []).includes(tagFilter));
  }, [search, tab.entries, tagFilter, tags]);
  const selected = new Set(tab.selection);
  const cutSet = new Set(clipboard?.mode === "cut" ? clipboard.paths : []);

  const containerRef = useRef<HTMLDivElement>(null);
  const width = useWidth(containerRef);
  const cols = view === "grid" ? Math.max(1, Math.floor((width - GRID_PAD * 2 + 6) / CARD_W)) : 1;
  const rowCount = view === "grid" ? Math.ceil(entries.length / cols) : entries.length;
  const rowH = view === "grid" ? CARD_H : ROW_H;
  const headH = view === "details" ? HEAD_H : 0;
  const vr = useVirtual(containerRef, rowCount, rowH, headH);

  /** Qualquer interação com este painel dá foco a ele PRIMEIRO. */
  const focar = () => {
    if (useFiles.getState().activePane !== pane) useFiles.getState().setActivePane(pane);
  };

  const setSelection = (paths: string[], anchor?: number | null, focus?: number | null) => {
    focar();
    useFiles.getState().setSelection(paths, anchor, focus);
  };

  const clickEntry = (e: React.MouseEvent, entry: Entry, index: number) => {
    e.stopPropagation();
    if (e.shiftKey && tab.anchor !== null) {
      const [a, b] = [Math.min(tab.anchor, index), Math.max(tab.anchor, index)];
      setSelection(entries.slice(a, b + 1).map((x) => x.path), undefined, index);
    } else if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      setSelection([...next], index, index);
    } else {
      setSelection([entry.path], index, index);
    }
  };

  const contextEntry = (e: React.MouseEvent, entry: Entry | null, index?: number) => {
    e.preventDefault();
    e.stopPropagation();
    focar();
    if (entry && !selected.has(entry.path)) setSelection([entry.path], index ?? null, index ?? null);
    setMenu({ x: e.clientX, y: e.clientY, targetPath: entry?.path ?? null });
  };

  const dragHandlers = (entry: Entry) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      focar();
      const paths = selected.has(entry.path) ? [...selected] : [entry.path];
      e.dataTransfer.setData("application/x-localfiles", JSON.stringify(paths));
      e.dataTransfer.effectAllowed = "copyMove";
    },
    onDragOver: (e: React.DragEvent) => {
      if (entry.isDir && e.dataTransfer.types.includes("application/x-localfiles")) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = e.ctrlKey ? "copy" : "move";
      }
    },
    onDrop: (e: React.DragEvent) => {
      if (!entry.isDir) return;
      const raw = e.dataTransfer.getData("application/x-localfiles");
      if (!raw) return;
      e.preventDefault();
      e.stopPropagation();
      const paths: string[] = JSON.parse(raw);
      if (paths.includes(entry.path)) return; // soltou em si mesmo
      void useFiles.getState().startOp(paths, entry.path, !e.ctrlKey);
    },
  });

  // Fundo: clique limpa seleção; contexto = menu da pasta; drop solta aqui.
  const backgroundProps = {
    onClick: () => setSelection([], null, null),
    onContextMenu: (e: React.MouseEvent) => contextEntry(e, null),
    onDragOver: (e: React.DragEvent) => {
      if (!search && e.dataTransfer.types.includes("application/x-localfiles")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = e.ctrlKey ? "copy" : "move";
      }
    },
    onDrop: (e: React.DragEvent) => {
      if (search) return;
      const raw = e.dataTransfer.getData("application/x-localfiles");
      if (!raw) return;
      e.preventDefault();
      void useFiles.getState().startOp(JSON.parse(raw), tab.path, !e.ctrlKey);
    },
  };

  useEffect(() => {
    // Pasta nova/busca nova: scroll no topo.
    containerRef.current?.scrollTo({ top: 0 });
  }, [tab.path, search?.opId]);

  // Seleção por teclado: garante o item focado visível.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || tab.focusIdx === null) return;
    const rowIdx = view === "grid" ? Math.floor(tab.focusIdx / cols) : tab.focusIdx;
    const top = headH + rowIdx * rowH;
    if (top < el.scrollTop) el.scrollTo({ top });
    else if (top + rowH > el.scrollTop + el.clientHeight) {
      el.scrollTo({ top: top + rowH - el.clientHeight });
    }
  }, [tab.focusIdx, view, cols, rowH, headH]);

  const searchBar = search ? (
    <div className="search-bar">
      <span className="search-info">
        {t("search.results", { q: search.query })} —{" "}
        {search.running ? t("search.running") : t("search.count", { n: search.results.length })}{" "}
        {search.truncated && t("search.truncated", { max: 2000 })}
      </span>
      <button
        className="search-close"
        title={t("search.close")}
        onClick={() => useFiles.getState().clearSearch()}
      >
        ✕
      </button>
    </div>
  ) : null;

  const filterBar = tagFilter ? (
    <div className="tagfilter-bar">
      <span>🏷 {t("tag.filtering", { tag: tagFilter })}</span>
      <button
        className="search-close"
        title={t("tag.clearFilter")}
        onClick={() => useFiles.getState().setTagFilter(null)}
      >
        ✕
      </button>
    </div>
  ) : null;

  /** Cabeçalho do painel: só existe no modo duplo, e é onde se vê ONDE cada
   *  lado está. Sem ele, o painel sem foco não teria caminho visível nenhum. */
  const paneHeader = dual ? <PaneHeader pane={pane} path={tab.path} focado={focado} /> : null;

  const wrap = (body: React.ReactNode) => (
    <div
      className={`filelist-column ${dual ? "in-pane" : ""} ${focado ? "focused" : ""}`}
      onMouseDown={focar}
    >
      {paneHeader}
      {searchBar}
      {filterBar}
      {body}
    </div>
  );

  if (!search && tab.loading) return wrap(<div className="filelist-msg">{t("list.loading")}</div>);
  if (!search && tab.error)
    return wrap(<div className="filelist-msg error">{t("list.denied", { error: tab.error })}</div>);
  if (entries.length === 0)
    return wrap(
      <div className="filelist-msg empty" {...backgroundProps}>
        {search
          ? search.running
            ? t("search.running")
            : t("search.none")
          : tagFilter
            ? t("tag.noneHere")
            : t("list.empty")}
      </div>,
    );

  const rowClass = (entry: Entry) =>
    [
      "row",
      selected.has(entry.path) ? "selected" : "",
      cutSet.has(entry.path) ? "cut" : "",
      entry.hidden ? "hidden-entry" : "",
    ]
      .filter(Boolean)
      .join(" ");

  const nameCell = (entry: Entry) =>
    renaming === entry.path ? (
      <RenameInput entry={entry} />
    ) : (
      <>
        <span className="entry-name">{entry.name}</span>
        <TagDots tags={tags[tagKeyOf(entry.path)] ?? []} />
      </>
    );

  let body: React.ReactNode;

  if (view === "grid") {
    const rows: React.ReactNode[] = [];
    for (let r = vr.start; r < vr.end; r++) {
      const slice = entries.slice(r * cols, r * cols + cols);
      rows.push(
        <div className="grid-row" key={r} style={{ height: CARD_H }}>
          {slice.map((entry, j) => {
            const i = r * cols + j;
            return (
              <div
                key={entry.path}
                className={`card ${rowClass(entry)}`}
                style={{ width: CARD_W - 6 }}
                onClick={(e) => clickEntry(e, entry, i)}
                onDoubleClick={() => actions.openEntry(entry)}
                onContextMenu={(e) => contextEntry(e, entry, i)}
                title={search ? entry.path : entry.name}
                {...dragHandlers(entry)}
              >
                <EntryVisual entry={entry} size={44} />
                {nameCell(entry)}
              </div>
            );
          })}
        </div>,
      );
    }
    body = (
      <div className="filelist grid" ref={containerRef} {...backgroundProps}>
        <div style={{ height: vr.padTop }} />
        {rows}
        <div style={{ height: vr.padBottom }} />
      </div>
    );
  } else if (view === "list") {
    body = (
      <div className="filelist listview" ref={containerRef} {...backgroundProps}>
        <div style={{ height: vr.padTop }} />
        {entries.slice(vr.start, vr.end).map((entry, k) => {
          const i = vr.start + k;
          return (
            <div
              key={entry.path}
              className={rowClass(entry)}
              style={{ height: ROW_H }}
              onClick={(e) => clickEntry(e, entry, i)}
              onDoubleClick={() => actions.openEntry(entry)}
              onContextMenu={(e) => contextEntry(e, entry, i)}
              title={search ? entry.path : undefined}
              {...dragHandlers(entry)}
            >
              <span className="entry-icon">{KIND_ICON[kindOf(entry)]}</span>
              {nameCell(entry)}
            </div>
          );
        })}
        <div style={{ height: vr.padBottom }} />
      </div>
    );
  } else {
    const header = (key: SortBy, label: string) => (
      <button className="col-header" onClick={() => useFiles.getState().setSort(key)}>
        {label}
        {sortBy === key && <span className="sort-arrow">{sortDir === "asc" ? "▲" : "▼"}</span>}
      </button>
    );
    body = (
      <div
        className={`filelist details ${search ? "with-folder" : ""}`}
        ref={containerRef}
        {...backgroundProps}
      >
        <div className="details-head">
          <div className="cell name">{header("name", t("col.name"))}</div>
          {search && <div className="cell folder">{t("col.folder")}</div>}
          <div className="cell date">{header("modified", t("col.modified"))}</div>
          {!search && <div className="cell type">{header("type", t("col.type"))}</div>}
          <div className="cell size">{header("size", t("col.size"))}</div>
        </div>
        <div style={{ height: vr.padTop }} />
        {entries.slice(vr.start, vr.end).map((entry, k) => {
          const i = vr.start + k;
          return (
            <div
              key={entry.path}
              className={rowClass(entry)}
              style={{ height: ROW_H }}
              onClick={(e) => clickEntry(e, entry, i)}
              onDoubleClick={() => actions.openEntry(entry)}
              onContextMenu={(e) => contextEntry(e, entry, i)}
              {...dragHandlers(entry)}
            >
              <div className="cell name">
                <span className="entry-icon">{KIND_ICON[kindOf(entry)]}</span>
                {nameCell(entry)}
              </div>
              {search && (
                <div className="cell folder" title={parentOf(entry.path) ?? ""}>
                  {parentOf(entry.path) ?? ""}
                </div>
              )}
              <div className="cell date">{formatDate(entry.modifiedMs, localeTag())}</div>
              {!search && (
                <div className="cell type">
                  {entry.isDir
                    ? t("kind.folder")
                    : t(`kind.${kindOf(entry)}` as Parameters<typeof t>[0])}
                </div>
              )}
              <div className="cell size">{entry.isDir ? "—" : formatBytes(entry.size)}</div>
            </div>
          );
        })}
        <div style={{ height: vr.padBottom }} />
      </div>
    );
  }

  return wrap(body);
}

/** Chave de etiqueta (espelho do `tagKey` — repetido aqui só pra leitura). */
function tagKeyOf(path: string): string {
  const p = path.replace(/[\\/]+$/, "");
  return /^[a-zA-Z]:[\\/]|^\\\\/.test(p) ? p.toLowerCase() : p;
}

/** Etiquetas do item, discretas ao lado do nome. */
function TagDots({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <span className="tag-dots" title={tags.join(", ")}>
      {tags.map((tg) => (
        <span key={tg} className="tag-chip">
          {tg}
        </span>
      ))}
    </span>
  );
}

/**
 * Cabeçalho de um painel no modo duplo: caminho clicável (inclusive o pedaço
 * de DENTRO de um arquivo compactado) e a marca de quem está com o foco.
 */
function PaneHeader({ pane, path, focado }: { pane: Pane; path: string; focado: boolean }) {
  const v = splitVirtual(path);
  const navigate = (p: string) => void useFiles.getState().navigate(p, { pane });
  const diskPath = v ? v.archive : path;
  const crumbs = breadcrumbOf(diskPath);
  // Dentro de um arquivo, o último pedaço do disco é o ARQUIVO: dali pra frente
  // os segmentos são internos, e a raiz do arquivo é um destino navegável.
  const dentro = v ? innerCrumbs(path) : [];

  return (
    <div className={`pane-header ${focado ? "focused" : ""}`}>
      <span className="pane-dot" title={focado ? t("pane.focused") : t("pane.unfocused")}>
        {focado ? "●" : "○"}
      </span>
      <div className="pane-crumbs">
        {crumbs.map((c, i) => (
          <span key={c.path} className="crumb-wrap">
            {i > 0 && <span className="crumb-sep">›</span>}
            <button className="crumb" title={c.path} onClick={() => navigate(c.path)}>
              {c.name}
            </button>
          </span>
        ))}
        {v && (
          <span className="crumb-wrap">
            <span className="crumb-sep">›</span>
            <button
              className="crumb in-archive"
              title={t("arch.root")}
              onClick={() => navigate(`${v.archive}::`)}
            >
              🗜
            </button>
          </span>
        )}
        {dentro.map((c) => (
          <span key={c.path} className="crumb-wrap">
            <span className="crumb-sep">›</span>
            <button className="crumb in-archive" onClick={() => navigate(c.path)}>
              {c.name}
            </button>
          </span>
        ))}
      </div>
      {isVirtual(path) && <span className="pane-badge">{t("arch.badge")}</span>}
    </div>
  );
}

/** Ícone ou miniatura (imagens ganham thumbnail real na grade). */
export function EntryVisual({ entry, size }: { entry: Entry; size: number }) {
  const [thumb, setThumb] = useState<string | null>(null);
  // Dentro de um arquivo compactado não há caminho de disco pra miniatura:
  // gerar exigiria extrair pro temporário a cada rolagem.
  const isImage = kindOf(entry) === "image" && !isVirtual(entry.path);

  useEffect(() => {
    let alive = true;
    setThumb(null);
    if (isImage) {
      void getThumb(entry.path, 96).then((url) => {
        if (alive) setThumb(url);
      });
    }
    return () => {
      alive = false;
    };
  }, [entry.path, entry.modifiedMs, isImage]);

  if (thumb) {
    return <img className="card-thumb" src={thumb} alt="" style={{ height: size + 12 }} />;
  }
  return (
    <span className="card-icon" style={{ fontSize: size - 10 }}>
      {KIND_ICON[kindOf(entry)]}
    </span>
  );
}

/** Campo de renomear inline (F2 / menu): Enter confirma, Esc cancela. */
function RenameInput({ entry }: { entry: Entry }) {
  const [value, setValue] = useState(entry.name);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // Seleciona só o nome, sem a extensão (padrão Explorer).
    const dot = entry.name.lastIndexOf(".");
    el.setSelectionRange(0, entry.isDir || dot <= 0 ? entry.name.length : dot);
  }, [entry]);

  return (
    <input
      ref={ref}
      className="rename-input"
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") void actions.confirmRename(entry.path, value);
        if (e.key === "Escape") useFiles.getState().setRenaming(null);
      }}
      onBlur={() => void actions.confirmRename(entry.path, value)}
    />
  );
}
