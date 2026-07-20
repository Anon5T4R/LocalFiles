import { splitVirtual } from "../lib/apath";
import { t } from "../lib/i18n";
import type { Pane } from "../lib/types";
import { useFiles } from "../state/tabs";

/**
 * Abas de navegação (Ctrl+T abre, Ctrl+W fecha, botão do meio fecha).
 *
 * No modo duplo mostra os DOIS grupos lado a lado, separados: cada painel tem
 * as abas dele, e clicar numa aba do outro grupo também move o foco pra lá.
 * Mostrar só as do painel ativo seria mais simples, mas esconderia metade das
 * abas abertas — o usuário perderia de vista o que ele mesmo abriu.
 */
export default function TabsBar() {
  const tabs = useFiles((s) => s.tabs);
  const activeIds = useFiles((s) => s.activeIds);
  const activePane = useFiles((s) => s.activePane);
  const dual = useFiles((s) => s.dual);
  const { newTab, closeTab, setActiveTab, setActivePane } = useFiles.getState();

  const labelOf = (path: string) => {
    const v = splitVirtual(path);
    if (v) {
      // Dentro de um arquivo: mostra o pedaço interno, ou o nome do arquivo na raiz.
      const dentro = v.inner.split("/").filter(Boolean).pop();
      const nome = v.archive.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() ?? path;
      return `🗜 ${dentro ?? nome}`;
    }
    const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? path;
  };

  const grupo = (pane: Pane) => {
    const doPainel = tabs.filter((tb) => tb.pane === pane);
    return (
      <div
        className={`tabs-group ${dual && activePane === pane ? "active-pane" : ""}`}
        onMouseDown={() => dual && setActivePane(pane)}
      >
        {doPainel.map((tab) => (
          <div
            key={tab.id}
            className={`tab ${tab.id === activeIds[pane] ? "active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
            onAuxClick={(e) => {
              if (e.button === 1) closeTab(tab.id);
            }}
            title={tab.path}
          >
            <span className="tab-label">{labelOf(tab.path)}</span>
            {doPainel.length > 1 && (
              <button
                className="tab-close"
                title={t("tabs.closeTab")}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button
          className="tab-new"
          title={t("tabs.newTab")}
          onClick={() => {
            setActivePane(pane);
            newTab();
          }}
        >
          +
        </button>
      </div>
    );
  };

  return (
    <div className={`tabsbar ${dual ? "dual" : ""}`}>
      {grupo(0)}
      {dual && <div className="tabs-divider" />}
      {dual && grupo(1)}
    </div>
  );
}
