import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import * as actions from "./lib/actions";
import { getStartupDir } from "./lib/backend";
import { t } from "./lib/i18n";
import type { OpDone, OpProgress } from "./lib/types";
import ContextMenu from "./components/ContextMenu";
import FileList from "./components/FileList";
import Modals from "./components/Modals";
import OpsPanel from "./components/OpsPanel";
import SettingsModal from "./components/SettingsModal";
import Sidebar from "./components/Sidebar";
import StatusBar from "./components/StatusBar";
import TabsBar from "./components/TabsBar";
import TopBar from "./components/TopBar";
import Toasts from "./components/Toasts";
import { FALLBACK_DIR, useFiles } from "./state/tabs";
import { useUi } from "./state/ui";

/** Rodando dentro do Tauri? (o smoke em navegador puro não tem a ponte). */
const isTauri = "__TAURI_INTERNALS__" in window;

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

  // Eventos do back-end: progresso/fim das transferências + open-dir (2ª instância).
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
    // Arrastar arquivos DE FORA (Explorer → LocalFiles): copia pra pasta atual.
    const un4 = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "drop" && event.payload.paths.length > 0) {
        const files = useFiles.getState();
        const dest = files.activeTab().path;
        void files.startOp(event.payload.paths, dest, false);
      }
    });
    return () => {
      void un1.then((f) => f());
      void un2.then((f) => f());
      void un3.then((f) => f());
      void un4.then((f) => f());
    };
  }, []);

  // Atalhos de teclado globais (fora de campos de texto).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
      const files = useFiles.getState();
      const tab = files.activeTab();
      const key = e.key.toLowerCase();

      if (e.ctrlKey && key === "t") { e.preventDefault(); files.newTab(); return; }
      if (e.ctrlKey && key === "w") { e.preventDefault(); files.closeTab(files.activeTabId); return; }
      if (e.ctrlKey && key === "a") { e.preventDefault(); actions.selectAll(); return; }
      if (e.ctrlKey && key === "c") { e.preventDefault(); actions.copySelection(false); return; }
      if (e.ctrlKey && key === "x") { e.preventDefault(); actions.copySelection(true); return; }
      if (e.ctrlKey && key === "v") { e.preventDefault(); actions.paste(); return; }
      if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); files.goBack(); return; }
      if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); files.goForward(); return; }
      if (e.key === "F5") { e.preventDefault(); void files.refresh(); return; }
      if (e.key === "F2") { e.preventDefault(); actions.startRename(); return; }
      if (e.key === "Delete") { e.preventDefault(); actions.askDelete(); return; }
      if (e.key === "Backspace") { e.preventDefault(); files.goUp(); return; }
      if (e.key === "Enter" && tab.selection.length === 1) {
        const entry = tab.entries.find((x) => x.path === tab.selection[0]);
        if (entry) { e.preventDefault(); actions.openEntry(entry); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <TabsBar />
      <TopBar />
      <div className="main">
        <Sidebar />
        <div className="content">
          <FileList />
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
