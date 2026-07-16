import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import * as actions from "./lib/actions";
import { getStartupDir, isTauri, watchDir } from "./lib/backend";
import { t } from "./lib/i18n";
import type { OpDone, OpProgress, SearchBatch, SearchDone } from "./lib/types";
import ContextMenu from "./components/ContextMenu";
import FileList from "./components/FileList";
import Modals from "./components/Modals";
import OpsPanel from "./components/OpsPanel";
import PreviewPanel from "./components/PreviewPanel";
import SettingsModal from "./components/SettingsModal";
import Sidebar from "./components/Sidebar";
import StatusBar from "./components/StatusBar";
import TabsBar from "./components/TabsBar";
import TopBar from "./components/TopBar";
import Toasts from "./components/Toasts";
import { FALLBACK_DIR, useFiles } from "./state/tabs";
import { useUi } from "./state/ui";

/** Type-ahead: digitar seleciona o primeiro item que começa com o prefixo. */
let typeBuffer = "";
let typeTimer: number | undefined;

export default function App() {
  // Boot: sidebar + pasta inicial (argumento do launch > home > C:\).
  useEffect(() => {
    const files = useFiles.getState();
    if (!isTauri) return;
    void files.loadSidebar().then(async () => {
      const startup = await getStartupDir().catch(() => null);
      const home = useFiles.getState().places.find((p) => p.id === "home")?.path;
      await files.navigate(startup ?? home ?? FALLBACK_DIR, { pushHistory: false });
    });
  }, []);

  // Eventos do back-end: transferências, busca, watcher e 2ª instância.
  useEffect(() => {
    if (!isTauri) return;
    const un1 = listen<OpProgress>("fileop-progress", (e) => {
      useFiles.getState().opProgress(e.payload.opId, e.payload);
    });
    const un2 = listen<OpDone>("fileop-done", (e) => {
      const files = useFiles.getState();
      const ui = useUi.getState();
      const op = files.ops.find((o) => o.opId === e.payload.opId);
      files.opDone(e.payload.opId);
      if (e.payload.canceled) ui.pushToast("info", t("ops.canceled"));
      else if (!e.payload.ok && e.payload.error)
        ui.pushToast("error", t("toast.opFailed", { error: e.payload.error }));
      else if (e.payload.ok) ui.pushToast("ok", t(op?.isMove ? "ops.moveDone" : "ops.copyDone"));
      void files.refresh();
    });
    const un3 = listen<string>("open-dir", (e) => {
      useFiles.getState().newTab(e.payload);
    });
    // Arrastar arquivos DE FORA (Explorer/Nautilus → LocalFiles): copia pra pasta atual.
    const un4 = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "drop" && event.payload.paths.length > 0) {
        const files = useFiles.getState();
        void files.startOp(event.payload.paths, files.activeTab().path, false);
      }
    });
    // Busca: lotes de resultado + fim.
    const un5 = listen<SearchBatch>("search-result", (e) => {
      useFiles.getState().appendSearchResults(e.payload.opId, e.payload.entries);
    });
    const un6 = listen<SearchDone>("search-done", (e) => {
      useFiles.getState().finishSearch(e.payload.opId, e.payload.truncated);
    });
    // Watcher: a pasta ativa mudou por fora → refresh silencioso.
    const un7 = listen<string>("dir-changed", (e) => {
      const files = useFiles.getState();
      if (e.payload === files.activeTab().path && !files.search) {
        void files.refresh({ silent: true });
      }
    });
    return () => {
      for (const un of [un1, un2, un3, un4, un5, un6, un7]) void un.then((f) => f());
    };
  }, []);

  // Atalhos de teclado globais (fora de campos de texto).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
      const files = useFiles.getState();
      const tab = files.activeTab();
      const entries = files.visibleEntries();
      const key = e.key.toLowerCase();

      if (e.ctrlKey && key === "t") { e.preventDefault(); files.newTab(); return; }
      if (e.ctrlKey && key === "w") { e.preventDefault(); files.closeTab(files.activeTabId); return; }
      if (e.ctrlKey && key === "a") { e.preventDefault(); actions.selectAll(); return; }
      if (e.ctrlKey && key === "c") { e.preventDefault(); actions.copySelection(false); return; }
      if (e.ctrlKey && key === "x") { e.preventDefault(); actions.copySelection(true); return; }
      if (e.ctrlKey && key === "v") { e.preventDefault(); actions.paste(); return; }
      if (e.ctrlKey && key === "d") { e.preventDefault(); files.toggleFavorite(tab.path); return; }
      if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); files.goBack(); return; }
      if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); files.goForward(); return; }
      if (e.altKey && key === "p") {
        e.preventDefault();
        const ui = useUi.getState();
        ui.setPreviewOpen(!ui.previewOpen);
        return;
      }
      if (e.key === "F5") { e.preventDefault(); void files.refresh(); return; }
      if (e.key === "F2") { e.preventDefault(); actions.startRename(); return; }
      if (e.key === "Delete") { e.preventDefault(); actions.askDelete(); return; }
      if (e.key === "Backspace") { e.preventDefault(); files.goUp(); return; }
      if (e.key === "Escape") { files.setSelection([], null, null); return; }
      if (e.key === "Enter" && tab.selection.length === 1) {
        const entry = entries.find((x) => x.path === tab.selection[0]);
        if (entry) { e.preventDefault(); actions.openEntry(entry); }
        return;
      }

      // Navegação por setas (Shift estende a partir da âncora).
      const NAV: Record<string, number> = {
        ArrowDown: 1,
        ArrowUp: -1,
        PageDown: 20,
        PageUp: -20,
      };
      if (e.key in NAV || e.key === "Home" || e.key === "End") {
        if (entries.length === 0) return;
        e.preventDefault();
        const cur = tab.focusIdx ?? -1;
        let next: number;
        if (e.key === "Home") next = 0;
        else if (e.key === "End") next = entries.length - 1;
        else next = Math.min(entries.length - 1, Math.max(0, cur + NAV[e.key]));
        if (e.shiftKey && tab.anchor !== null) {
          const [a, b] = [Math.min(tab.anchor, next), Math.max(tab.anchor, next)];
          files.setSelection(entries.slice(a, b + 1).map((x) => x.path), undefined, next);
        } else {
          files.setSelection([entries[next].path], next, next);
        }
        return;
      }

      // Type-ahead: letras/números pulam pro item com aquele prefixo.
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        typeBuffer += e.key.toLowerCase();
        window.clearTimeout(typeTimer);
        typeTimer = window.setTimeout(() => (typeBuffer = ""), 800);
        const idx = entries.findIndex((x) => x.name.toLowerCase().startsWith(typeBuffer));
        if (idx >= 0) files.setSelection([entries[idx].path], idx, idx);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Reobserva a pasta ativa quando o app volta do 2º plano (watcher barato).
  useEffect(() => {
    if (!isTauri) return;
    const onFocus = () => {
      const files = useFiles.getState();
      void watchDir(files.activeTab().path).catch(() => {});
      void files.refresh({ silent: true });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  return (
    <div className="app">
      <TabsBar />
      <TopBar />
      <div className="main">
        <Sidebar />
        <div className="content">
          <div className="content-row">
            <FileList />
            <PreviewPanel />
          </div>
          <StatusBar />
        </div>
      </div>
      <ContextMenu />
      <Modals />
      <SettingsModal />
      <OpsPanel />
      <Toasts />
    </div>
  );
}
