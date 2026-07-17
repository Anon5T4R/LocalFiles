import { formatBytes } from "../lib/fsutil";
import { t, type MessageKey } from "../lib/i18n";
import { useFiles } from "../state/tabs";
import FolderTree from "./FolderTree";

const PLACE_LABEL: Record<string, MessageKey> = {
  home: "side.home",
  desktop: "side.desktop",
  documents: "side.documents",
  downloads: "side.downloads",
  pictures: "side.pictures",
  music: "side.music",
  videos: "side.videos",
};

const PLACE_ICON: Record<string, string> = {
  home: "🏠",
  desktop: "🖥️",
  documents: "📝",
  downloads: "⬇️",
  pictures: "🖼️",
  music: "🎵",
  videos: "🎬",
};

/** Sidebar: locais conhecidos + favoritos + unidades (barra de espaço usado). */
export default function Sidebar() {
  const places = useFiles((s) => s.places);
  const drives = useFiles((s) => s.drives);
  const favorites = useFiles((s) => s.favorites);
  const current = useFiles(
    (s) => (s.tabs.find((tb) => tb.id === s.activeTabId) ?? s.tabs[0]).path,
  );
  const { navigate, startOp, toggleFavorite } = useFiles.getState();

  /** Soltar itens arrastados num destino da sidebar = mover (Ctrl = copiar). */
  const dropHandlers = (destDir: string) => ({
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
      const paths: string[] = JSON.parse(raw);
      void startOp(paths, destDir, !e.ctrlKey);
    },
  });

  return (
    <aside className="sidebar">
      <div className="side-title">{t("side.places")}</div>
      {places.map((p) => (
        <FolderTree
          key={p.id}
          path={p.path}
          icon={PLACE_ICON[p.id] ?? "📁"}
          label={PLACE_LABEL[p.id] ? t(PLACE_LABEL[p.id]) : p.id}
          depth={0}
        />
      ))}

      {favorites.length > 0 && (
        <>
          <div className="side-title">{t("side.favorites")}</div>
          {favorites.map((f) => (
            <div key={f.path} className="side-fav-wrap">
              <button
                className={`side-item ${current === f.path ? "active" : ""}`}
                onClick={() => void navigate(f.path)}
                title={f.path}
                {...dropHandlers(f.path)}
              >
                <span className="side-icon">★</span>
                <span className="side-name">{f.name}</span>
              </button>
              <button
                className="side-fav-remove"
                title={t("menu.removeFavorite")}
                onClick={() => toggleFavorite(f.path)}
              >
                ×
              </button>
            </div>
          ))}
        </>
      )}

      <div className="side-title">{t("side.drives")}</div>
      {drives.map((d) => {
        const used = d.total > 0 ? (d.total - d.available) / d.total : 0;
        return (
          <FolderTree
            key={d.mount}
            path={d.mount}
            icon={d.removable ? "🔌" : "💽"}
            depth={0}
            label={
              <span title={t("side.freeOf", { free: formatBytes(d.available), total: formatBytes(d.total) })}>
                {d.name ? `${d.name} (${d.mount})` : d.mount}
                <span className="drive-bar">
                  <span className="drive-used" style={{ width: `${Math.round(used * 100)}%` }} />
                </span>
              </span>
            }
          />
        );
      })}
    </aside>
  );
}
