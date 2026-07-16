import { useEffect, useRef } from "react";
import * as actions from "../lib/actions";
import { t } from "../lib/i18n";
import { useFiles } from "../state/tabs";
import { useUi } from "../state/ui";

/** Menu de contexto: itens mudam se o alvo é entrada ou o fundo da pasta. */
export default function ContextMenu() {
  const menu = useUi((s) => s.menu);
  const setMenu = useUi((s) => s.setMenu);
  const clipboard = useFiles((s) => s.clipboard);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu, setMenu]);

  // Reposiciona pra não sair da janela.
  useEffect(() => {
    const el = ref.current;
    if (!el || !menu) return;
    const r = el.getBoundingClientRect();
    if (r.right > window.innerWidth) el.style.left = `${menu.x - r.width}px`;
    if (r.bottom > window.innerHeight) el.style.top = `${menu.y - r.height}px`;
  }, [menu]);

  if (!menu) return null;

  const files = useFiles.getState();
  const tab = files.activeTab();
  const entries = files.visibleEntries();
  const target = menu.targetPath
    ? entries.find((e) => e.path === menu.targetPath) ?? null
    : null;
  const sel = tab.selection;
  const single = sel.length === 1 && target !== null;
  const multi = sel.length > 1;

  const item = (
    label: string,
    onClick: () => void,
    opts?: { disabled?: boolean; danger?: boolean },
  ) => (
    <button
      className={`menu-item ${opts?.danger ? "danger" : ""}`}
      disabled={opts?.disabled}
      onClick={() => {
        setMenu(null);
        onClick();
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="context-menu" ref={ref} style={{ left: menu.x, top: menu.y }}
      onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      {target ? (
        <>
          {item(t("menu.open"), () => actions.openEntry(target))}
          {target.isDir &&
            item(t("menu.openNewTab"), () => files.newTab(target.path))}
          {!target.isDir && item(t("menu.openWith"), () => actions.openWith(target.path))}
          <div className="menu-sep" />
          {item(t("menu.cut"), () => actions.copySelection(true))}
          {item(t("menu.copy"), () => actions.copySelection(false))}
          {target.isDir &&
            item(t("menu.paste"), () => actions.paste(target.path), {
              disabled: !clipboard,
            })}
          <div className="menu-sep" />
          {single && item(t("menu.rename"), () => actions.startRename(target.path))}
          {multi && item(t("menu.batchRename"), () => actions.askBatchRename())}
          {item(t("menu.delete"), () => actions.askDelete(), { danger: true })}
          <div className="menu-sep" />
          {target.isDir &&
            item(
              files.isFavorite(target.path) ? t("menu.removeFavorite") : t("menu.addFavorite"),
              () => files.toggleFavorite(target.path),
            )}
          {item(t("menu.copyPath"), () => void actions.copyPathToClipboard(target.path))}
          {item(t("menu.properties"), () => actions.showProperties(target.path))}
        </>
      ) : (
        <>
          {item(t("menu.paste"), () => actions.paste(), { disabled: !clipboard })}
          {item(t("menu.newFolder"), () => actions.askNewFolder())}
          <div className="menu-sep" />
          {item(t("menu.selectAll"), () => actions.selectAll())}
          {item(t("menu.refresh"), () => void files.refresh())}
          <div className="menu-sep" />
          {item(t("menu.properties"), () => actions.showProperties(tab.path))}
        </>
      )}
    </div>
  );
}
