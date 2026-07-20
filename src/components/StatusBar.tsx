import { useMemo } from "react";
import { formatBytes } from "../lib/fsutil";
import { t } from "../lib/i18n";
import { useFiles } from "../state/tabs";

/** Rodapé: contagem, seleção (com tamanho somado) e espaço livre do drive. */
export default function StatusBar() {
  const tab = useFiles((s) => s.activeTab());
  const drives = useFiles((s) => s.drives);

  // As entradas VISÍVEIS, não as da pasta: com filtro de etiqueta ligado, a
  // barra tem que contar o que está na tela, senão o número mente.
  // Derivado aqui (e não num seletor): `visibleEntries()` devolve um array novo
  // quando há filtro de etiqueta, e seletor instável faz o zustand v5
  // re-renderizar em looping.
  const search = useFiles((s) => s.search);
  const tagFilter = useFiles((s) => s.tagFilter);
  const tags = useFiles((s) => s.tags);
  const entries = useMemo(() => {
    const base = search ? search.results : tab.entries;
    if (!tagFilter) return base;
    const key = (p: string) => {
      const q = p.replace(/[\/]+$/, "");
      return /^[a-zA-Z]:[\/]|^\\/.test(q) ? q.toLowerCase() : q;
    };
    return base.filter((e) => e.isDir || (tags[key(e.path)] ?? []).includes(tagFilter));
  }, [search, tab.entries, tagFilter, tags]);
  const n = entries.length;
  const sel = tab.selection;
  const selSize = entries
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
      {drive && (
        <span className="status-drive">
          <span className="status-bar-track">
            <span
              className="status-bar-used"
              style={{
                width: `${drive.total > 0 ? Math.round(((drive.total - drive.available) / drive.total) * 100) : 0}%`,
              }}
            />
          </span>
          {t("status.free", { free: formatBytes(drive.available) })}
        </span>
      )}
    </div>
  );
}
