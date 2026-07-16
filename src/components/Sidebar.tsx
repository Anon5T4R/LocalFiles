import { formatBytes } from "../lib/fsutil";
import { t, type MessageKey } from "../lib/i18n";
import { useFiles } from "../state/tabs";

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

/** Sidebar: locais conhecidos + unidades (com barra de espaço usado). */
export default function Sidebar() {
  const places = useFiles((s) => s.places);
  const drives = useFiles((s) => s.drives);
  const current = useFiles(
    (s) => (s.tabs.find((tb) => tb.id === s.activeTabId) ?? s.tabs[0]).path,
  );
  const { navigate, startOp } = useFiles.getState();

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
        <button
          key={p.id}
          className={`side-item ${current === p.path ? "active" : ""}`}
          onClick={() => void navigate(p.path)}
          title={p.path}
          {...dropHandlers(p.path)}
        >
          <span className="side-icon">{PLACE_ICON[p.id] ?? "📁"}</span>
          <span className="side-name">{PLACE_LABEL[p.id] ? t(PLACE_LABEL[p.id]) : p.id}</span>
        </button>
      ))}

      <div className="side-title">{t("side.drives")}</div>
      {drives.map((d) => {
        const used = d.total > 0 ? (d.total - d.available) / d.total : 0;
        return (
          <button
            key={d.mount}
            className={`side-item drive ${current === d.mount ? "active" : ""}`}
            onClick={() => void navigate(d.mount)}
            title={t("side.freeOf", {
              free: formatBytes(d.available),
              total: formatBytes(d.total),
            })}
            {...dropHandlers(d.mount)}
          >
            <span className="side-icon">{d.removable ? "🔌" : "💽"}</span>
            <span className="side-name">
              {d.name ? `${d.name} (${d.mount})` : d.mount}
              <span className="drive-bar">
                <span className="drive-used" style={{ width: `${Math.round(used * 100)}%` }} />
              </span>
            </span>
          </button>
        );
      })}
    </aside>
  );
}
