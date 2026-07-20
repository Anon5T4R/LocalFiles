import { useEffect, useRef, useState } from "react";
import * as actions from "../lib/actions";
import { innerCrumbs, splitVirtual } from "../lib/apath";
import { breadcrumbOf } from "../lib/fsutil";
import { t } from "../lib/i18n";
import { useFiles } from "../state/tabs";
import { useUi } from "../state/ui";

/**
 * Barra superior: navegação, breadcrumb (clica pra editar; segmento aceita
 * drop), busca (Ctrl+F), nova pasta, ocultos, preview, favorito, visão, config.
 */
export default function TopBar() {
  const tab = useFiles((s) => s.activeTab());
  const view = useFiles((s) => s.view);
  const search = useFiles((s) => s.search);
  const dual = useFiles((s) => s.dual);
  const isFav = useFiles((s) => s.favorites.some((f) => f.path === tab.path));
  const { navigate, goBack, goForward, goUp, refresh, setView, startOp, toggleFavorite, toggleDual } =
    useFiles.getState();
  const showHidden = useUi((s) => s.showHidden);
  const previewOpen = useUi((s) => s.previewOpen);
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);
  const pushToast = useUi((s) => s.pushToast);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tab.path);
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [inContent, setInContent] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(tab.path);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing, tab.path]);

  // Ctrl+L edita o caminho; Ctrl+F foca a busca (padrão navegador/Explorer).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        setEditing(true);
      }
      if (e.ctrlKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Busca fechada por fora (navegou): limpa o campo.
  useEffect(() => {
    if (!search) setQuery("");
  }, [search]);

  const submitPath = async () => {
    setEditing(false);
    const target = draft.trim();
    if (!target || target === tab.path) return;
    try {
      await navigate(target);
      const err = useFiles.getState().activeTab().error;
      if (err) pushToast("error", t("toast.invalidPath", { path: target }));
    } catch {
      pushToast("error", t("toast.invalidPath", { path: target }));
    }
  };

  const submitSearch = () => {
    const q = query.trim();
    if (!q) return;
    void useFiles.getState().startSearch(q, inContent);
  };

  /** Segmento do breadcrumb aceita drop (mover pro ancestral; Ctrl = copiar). */
  const crumbDrop = (destDir: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes("application/x-localfiles")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = e.ctrlKey ? "copy" : "move";
      }
    },
    onDrop: (e: React.DragEvent) => {
      const raw = e.dataTransfer.getData("application/x-localfiles");
      if (!raw) return;
      e.preventDefault();
      void startOp(JSON.parse(raw), destDir, !e.ctrlKey);
    },
  });

  // Dentro de um arquivo compactado o caminho tem duas metades: a do disco
  // (até o arquivo) e a de dentro. As duas viram breadcrumb navegável.
  const v = splitVirtual(tab.path);
  const crumbs = breadcrumbOf(v ? v.archive : tab.path);
  const dentro = v ? innerCrumbs(tab.path) : [];

  return (
    <div className="topbar">
      <div className="nav-buttons">
        <button title={t("nav.back")} disabled={tab.histIndex <= 0} onClick={goBack}>
          ←
        </button>
        <button
          title={t("nav.forward")}
          disabled={tab.histIndex >= tab.history.length - 1}
          onClick={goForward}
        >
          →
        </button>
        <button title={t("nav.up")} onClick={goUp}>
          ↑
        </button>
        <button title={t("nav.refresh")} onClick={() => void refresh()}>
          ⟳
        </button>
      </div>

      {editing ? (
        <input
          ref={inputRef}
          className="path-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submitPath();
            if (e.key === "Escape") setEditing(false);
          }}
          onBlur={() => setEditing(false)}
          spellCheck={false}
        />
      ) : (
        <div className="breadcrumb" title={t("nav.editPath")} onClick={(e) => {
          if (e.target === e.currentTarget) setEditing(true);
        }}>
          {crumbs.map((c, i) => (
            <span key={c.path} className="crumb-wrap">
              {i > 0 && <span className="crumb-sep">›</span>}
              <button
                className="crumb"
                onClick={() => void navigate(c.path)}
                onAuxClick={(e) => {
                  if (e.button === 1) useFiles.getState().newTab(c.path);
                }}
                title={c.path}
                {...crumbDrop(c.path)}
              >
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
                onClick={() => void navigate(`${v.archive}::`)}
              >
                🗜
              </button>
            </span>
          )}
          {dentro.map((c) => (
            <span key={c.path} className="crumb-wrap">
              <span className="crumb-sep">›</span>
              <button className="crumb in-archive" onClick={() => void navigate(c.path)}>
                {c.name}
              </button>
            </span>
          ))}
          <span className="crumb-fill" onClick={() => setEditing(true)} />
        </div>
      )}

      <div className="searchbox">
        <input
          ref={searchRef}
          value={query}
          placeholder={t("search.placeholder")}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitSearch();
            if (e.key === "Escape") {
              setQuery("");
              useFiles.getState().clearSearch();
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        <label className="search-content" title={t("search.inContentTitle")}>
          <input
            type="checkbox"
            checked={inContent}
            onChange={(e) => setInContent(e.target.checked)}
          />
          {t("search.inContent")}
        </label>
      </div>

      <div className="topbar-actions">
        <button
          className={dual ? "active" : ""}
          title={t("pane.toggleTitle")}
          onClick={toggleDual}
        >
          ⊞
        </button>
        {dual && (
          <>
            <button
              title={t("pane.copyTitle")}
              onClick={() => actions.transferToOtherPane(false)}
            >
              ⇥
            </button>
            <button
              title={t("pane.moveTitle")}
              onClick={() => actions.transferToOtherPane(true)}
            >
              ⇛
            </button>
          </>
        )}
        <button title={t("topbar.newFolder")} onClick={() => actions.askNewFolder()}>
          📁+
        </button>
        <button title={t("topbar.newFile")} onClick={() => actions.askNewFile()}>
          📄+
        </button>
        <button title={t("tag.title")} onClick={() => actions.askTags()}>
          🏷
        </button>
        <button
          className={isFav ? "active" : ""}
          title={t("topbar.favTitle")}
          onClick={() => toggleFavorite(tab.path)}
        >
          {isFav ? "★" : "☆"}
        </button>
        <button
          className={showHidden ? "active" : ""}
          title={t("topbar.showHidden")}
          onClick={() => {
            useUi.getState().setShowHidden(!showHidden);
            void refresh();
          }}
        >
          👁
        </button>
        <button
          className={previewOpen ? "active" : ""}
          title={t("preview.toggle")}
          onClick={() => useUi.getState().setPreviewOpen(!previewOpen)}
        >
          ◧
        </button>
        <div className="view-switch" role="group">
          <button
            className={view === "details" ? "active" : ""}
            title={t("view.details")}
            onClick={() => setView("details")}
          >
            ☰
          </button>
          <button
            className={view === "list" ? "active" : ""}
            title={t("view.list")}
            onClick={() => setView("list")}
          >
            ≡
          </button>
          <button
            className={view === "grid" ? "active" : ""}
            title={t("view.grid")}
            onClick={() => setView("grid")}
          >
            ▦
          </button>
        </div>
        <button title={t("topbar.settingsTitle")} onClick={() => setSettingsOpen(true)}>
          ⚙
        </button>
      </div>
    </div>
  );
}
