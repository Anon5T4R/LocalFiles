import { formatBytes } from "../lib/fsutil";
import { t } from "../lib/i18n";
import { useFiles } from "../state/tabs";

/** Rodapé: contagem, seleção (com tamanho somado) e espaço livre do drive. */
export default function StatusBar() {
  const tab = useFiles((s) => s.tabs.find((tb) => tb.id === s.activeTabId) ?? s.tabs[0]);
  const drives = useFiles((s) => s.drives);

  const n = tab.entries.length;
  const sel = tab.selection;
  const selSize = tab.entries
    .filter((e) => sel.includes(e.path) && !e.isDir)
    .reduce((acc, e) => acc + e.size, 0);

  // Drive da pasta atual = mount mais longo que prefixa o caminho.
  const drive = drives
    .filter((d) => tab.path.toLowerCase().startsWith(d.mount.toLowerCase()))
    .sort((a, b) => b.mount.length - a.mount.length)[0];

  return (
    <div className="statusbar">
      <span>{n === 1 ? t("status.item") : t("status.items", { n })}</span>
      {sel.length > 0 && (
        <span>
          {sel.length === 1
            ? t("status.selectedOne", { size: formatBytes(selSize) })
            : t("status.selected", { n: sel.length, size: formatBytes(selSize) })}
        </span>
      )}
      <span className="status-fill" />
      {drive && <span>{t("status.free", { free: formatBytes(drive.available) })}</span>}
    </div>
  );
}
