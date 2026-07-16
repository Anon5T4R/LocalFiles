import { t } from "../lib/i18n";
import { useFiles } from "../state/tabs";

/** Abas de navegação (Ctrl+T abre, Ctrl+W fecha, botão do meio fecha). */
export default function TabsBar() {
  const tabs = useFiles((s) => s.tabs);
  const activeTabId = useFiles((s) => s.activeTabId);
  const { newTab, closeTab, setActiveTab } = useFiles.getState();

  const labelOf = (path: string) => {
    const parts = path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? path;
  };

  return (
    <div className="tabsbar">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab ${tab.id === activeTabId ? "active" : ""}`}
          onClick={() => setActiveTab(tab.id)}
          onAuxClick={(e) => {
            if (e.button === 1) closeTab(tab.id);
          }}
          title={tab.path}
        >
          <span className="tab-label">{labelOf(tab.path)}</span>
          {tabs.length > 1 && (
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
      <button className="tab-new" title={t("tabs.newTab")} onClick={() => newTab()}>
        +
      </button>
    </div>
  );
}
