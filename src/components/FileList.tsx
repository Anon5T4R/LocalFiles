import { useEffect, useRef, useState } from "react";
import * as actions from "../lib/actions";
import { KIND_ICON, formatBytes, formatDate, kindOf } from "../lib/fsutil";
import { localeTag, t } from "../lib/i18n";
import type { Entry, SortBy } from "../lib/types";
import { useFiles } from "../state/tabs";
import { useUi } from "../state/ui";

/**
 * A área principal: lista de arquivos nas 3 visões (detalhes/lista/grade),
 * com seleção (clique/Ctrl/Shift), renomear inline (F2), drag-and-drop
 * interno (mover; Ctrl = copiar) e menu de contexto.
 */
export default function FileList() {
  const tab = useFiles((s) => s.tabs.find((tb) => tb.id === s.activeTabId) ?? s.tabs[0]);
  const view = useFiles((s) => s.view);
  const sortBy = useFiles((s) => s.sortBy);
  const sortDir = useFiles((s) => s.sortDir);
  const renaming = useFiles((s) => s.renaming);
  const clipboard = useFiles((s) => s.clipboard);
  const { setSelection, setSort, startOp } = useFiles.getState();
  const setMenu = useUi((s) => s.setMenu);

  const entries = tab.entries;
  const selected = new Set(tab.selection);
  const cutSet = new Set(clipboard?.mode === "cut" ? clipboard.paths : []);

  const containerRef = useRef<HTMLDivElement>(null);

  const clickEntry = (e: React.MouseEvent, entry: Entry, index: number) => {
    e.stopPropagation();
    if (e.shiftKey && tab.anchor !== null) {
      const [a, b] = [Math.min(tab.anchor, index), Math.max(tab.anchor, index)];
      setSelection(entries.slice(a, b + 1).map((x) => x.path));
    } else if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      setSelection([...next], index);
    } else {
      setSelection([entry.path], index);
    }
  };

  const contextEntry = (e: React.MouseEvent, entry: Entry | null, index?: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (entry && !selected.has(entry.path)) setSelection([entry.path], index ?? null);
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

  // Clique no fundo limpa a seleção; contexto no fundo = menu da pasta.
  const backgroundProps = {
    onClick: () => setSelection([], null),
    onContextMenu: (e: React.MouseEvent) => contextEntry(e, null),
  };

  useEffect(() => {
    // Nova pasta carregada: garante o scroll no topo.
    containerRef.current?.scrollTo({ top: 0 });
  }, [tab.path]);

  if (tab.loading) return <div className="filelist-msg">{t("list.loading")}</div>;
  if (tab.error)
    return <div className="filelist-msg error">{t("list.denied", { error: tab.error })}</div>;
  if (entries.length === 0)
    return (
      <div className="filelist-msg empty" {...backgroundProps}>
        {t("list.empty")}
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

  if (view === "grid") {
    return (
      <div className="filelist grid" ref={containerRef} {...backgroundProps}>
        {entries.map((entry, i) => (
          <div
            key={entry.path}
            className={`card ${rowClass(entry)}`}
            onClick={(e) => clickEntry(e, entry, i)}
            onDoubleClick={() => actions.openEntry(entry)}
            onContextMenu={(e) => contextEntry(e, entry, i)}
            title={entry.name}
            {...dragHandlers(entry)}
          >
            <span className="card-icon">{KIND_ICON[kindOf(entry)]}</span>
            {nameCell(entry)}
          </div>
        ))}
      </div>
    );
  }

  if (view === "list") {
    return (
      <div className="filelist listview" ref={containerRef} {...backgroundProps}>
        {entries.map((entry, i) => (
          <div
            key={entry.path}
            className={rowClass(entry)}
            onClick={(e) => clickEntry(e, entry, i)}
            onDoubleClick={() => actions.openEntry(entry)}
            onContextMenu={(e) => contextEntry(e, entry, i)}
            {...dragHandlers(entry)}
          >
            <span className="entry-icon">{KIND_ICON[kindOf(entry)]}</span>
            {nameCell(entry)}
          </div>
        ))}
      </div>
    );
  }

  // detalhes (tabela)
  const header = (key: SortBy, label: string) => (
    <button className="col-header" onClick={() => setSort(key)}>
      {label}
      {sortBy === key && <span className="sort-arrow">{sortDir === "asc" ? "▲" : "▼"}</span>}
    </button>
  );

  return (
    <div className="filelist details" ref={containerRef} {...backgroundProps}>
      <div className="details-head">
        <div className="cell name">{header("name", t("col.name"))}</div>
        <div className="cell date">{header("modified", t("col.modified"))}</div>
        <div className="cell type">{header("type", t("col.type"))}</div>
        <div className="cell size">{header("size", t("col.size"))}</div>
      </div>
      {entries.map((entry, i) => (
        <div
          key={entry.path}
          className={rowClass(entry)}
          onClick={(e) => clickEntry(e, entry, i)}
          onDoubleClick={() => actions.openEntry(entry)}
          onContextMenu={(e) => contextEntry(e, entry, i)}
          {...dragHandlers(entry)}
        >
          <div className="cell name">
            <span className="entry-icon">{KIND_ICON[kindOf(entry)]}</span>
            {nameCell(entry)}
          </div>
          <div className="cell date">{formatDate(entry.modifiedMs, localeTag())}</div>
          <div className="cell type">
            {entry.isDir ? t("kind.folder") : t(`kind.${kindOf(entry)}` as Parameters<typeof t>[0])}
          </div>
          <div className="cell size">{entry.isDir ? "—" : formatBytes(entry.size)}</div>
        </div>
      ))}
    </div>
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
