import { useEffect, useRef, useState } from "react";
import * as actions from "../lib/actions";
import { KIND_ICON, formatBytes, formatDate, kindOf, parentOf } from "../lib/fsutil";
import { localeTag, t } from "../lib/i18n";
import { getThumb } from "../lib/thumbs";
import type { Entry, SortBy } from "../lib/types";
import { useVirtual, useWidth } from "../lib/virtual";
import { useFiles } from "../state/tabs";
import { useUi } from "../state/ui";

/**
 * A área principal: lista de arquivos nas 3 visões (detalhes/lista/grade),
 * VIRTUALIZADA (pastas gigantes sem engasgo), com seleção (clique/Ctrl/Shift/
 * setas), renomear inline (F2), drag-and-drop, menu de contexto, miniaturas
 * de imagem na grade e modo "resultados de busca" (coluna da pasta).
 */

const ROW_H = 28;
const HEAD_H = 29;
const CARD_W = 116; // largura mínima do card + gap
const CARD_H = 104;
const GRID_PAD = 10;

export default function FileList() {
  const tab = useFiles((s) => s.tabs.find((tb) => tb.id === s.activeTabId) ?? s.tabs[0]);
  const search = useFiles((s) => s.search);
  const view = useFiles((s) => s.view);
  const sortBy = useFiles((s) => s.sortBy);
  const sortDir = useFiles((s) => s.sortDir);
  const renaming = useFiles((s) => s.renaming);
  const clipboard = useFiles((s) => s.clipboard);
  const { setSelection, setSort, startOp } = useFiles.getState();
  const setMenu = useUi((s) => s.setMenu);

  const entries = search ? search.results : tab.entries;
  const selected = new Set(tab.selection);
  const cutSet = new Set(clipboard?.mode === "cut" ? clipboard.paths : []);

  const containerRef = useRef<HTMLDivElement>(null);
  const width = useWidth(containerRef);
  const cols = view === "grid" ? Math.max(1, Math.floor((width - GRID_PAD * 2 + 6) / CARD_W)) : 1;
  const rowCount = view === "grid" ? Math.ceil(entries.length / cols) : entries.length;
  const rowH = view === "grid" ? CARD_H : ROW_H;
  const headH = view === "details" ? HEAD_H : 0;
  const vr = useVirtual(containerRef, rowCount, rowH, headH);

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
    if (entry && !selected.has(entry.path)) setSelection([entry.path], index ?? null, index ?? null);
    setMenu({ x: e.clientX, y: e.clientY, targetPath: entry?.path ?? null });
  };

  const dragHandlers = (entry: Entry) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
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
      void startOp(paths, entry.path, !e.ctrlKey);
    },
  });

  // Fundo: clique limpa seleção; contexto = menu da pasta; drop de outra aba
  // solta na pasta atual (mover; Ctrl = copiar).
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
      void startOp(JSON.parse(raw), tab.path, !e.ctrlKey);
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
        {search.running
          ? t("search.running")
          : t("search.count", { n: search.results.length })}{" "}
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

  if (!search && tab.loading)
    return <div className="filelist-msg">{t("list.loading")}</div>;
  if (!search && tab.error)
    return <div className="filelist-msg error">{t("list.denied", { error: tab.error })}</div>;
  if (entries.length === 0)
    return (
      <div className="filelist-column">
        {searchBar}
        <div className="filelist-msg empty" {...backgroundProps}>
          {search ? (search.running ? t("search.running") : t("search.none")) : t("list.empty")}
        </div>
      </div>
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
      <span className="entry-name">{entry.name}</span>
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
      <button className="col-header" onClick={() => setSort(key)}>
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

  return (
    <div className="filelist-column">
      {searchBar}
      {body}
    </div>
  );
}

/** Ícone ou miniatura (imagens ganham thumbnail real na grade). */
export function EntryVisual({ entry, size }: { entry: Entry; size: number }) {
  const [thumb, setThumb] = useState<string | null>(null);
  const isImage = kindOf(entry) === "image";

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
