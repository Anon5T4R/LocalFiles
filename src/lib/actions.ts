import { openPath } from "@tauri-apps/plugin-opener";
import * as backend from "./backend";
import { t } from "./i18n";
import type { Entry } from "./types";
import { useFiles } from "../state/tabs";
import { useUi } from "../state/ui";

/**
 * Ações compartilhadas entre menu de contexto, atalhos de teclado e toolbar.
 * Tudo passa por aqui pra o comportamento ser um só.
 */

export function openEntry(entry: Entry) {
  const files = useFiles.getState();
  if (entry.isDir) {
    void files.navigate(entry.path);
    return;
  }
  // Arquivo: app padrão do SO (respeita as associações registradas pelo Hub).
  openPath(entry.path).catch((e) =>
    useUi.getState().pushToast("error", t("toast.openFailed", { error: String(e) })),
  );
}

export function openWith(path: string) {
  backend.openWithDialog(path).catch(() => {
    // Linux não tem o diálogo nativo: cai pro app padrão.
    void openPath(path).catch((e) =>
      useUi.getState().pushToast("error", t("toast.openFailed", { error: String(e) })),
    );
  });
}

export function copySelection(cut: boolean) {
  const files = useFiles.getState();
  const sel = files.activeTab().selection;
  if (sel.length === 0) return;
  files.setClipboard({ mode: cut ? "cut" : "copy", paths: sel });
}

export function paste(destDir?: string) {
  const files = useFiles.getState();
  const clip = files.clipboard;
  if (!clip || clip.paths.length === 0) {
    useUi.getState().pushToast("info", t("toast.nothingToPaste"));
    return;
  }
  const dest = destDir ?? files.activeTab().path;
  void files.startOp(clip.paths, dest, clip.mode === "cut");
  if (clip.mode === "cut") files.setClipboard(null); // recorte só cola 1x
}

export function askDelete(paths?: string[]) {
  const files = useFiles.getState();
  const sel = paths ?? files.activeTab().selection;
  if (sel.length === 0) return;
  const first = sel[0].split(/[\\/]/).pop() ?? sel[0];
  useUi.getState().setDialog({ kind: "delete", paths: sel, firstName: first });
}

export async function confirmDelete(paths: string[]) {
  const ui = useUi.getState();
  ui.setDialog(null);
  try {
    await backend.deleteToTrash(paths);
    ui.pushToast("ok", t("toast.deleted", { n: paths.length }));
  } catch (e) {
    ui.pushToast("error", t("toast.deleteFailed", { error: String(e) }));
  }
  await useFiles.getState().refresh();
}

export function askNewFolder() {
  useUi.getState().setDialog({ kind: "newFolder" });
}

export async function confirmNewFolder(name: string) {
  const ui = useUi.getState();
  const files = useFiles.getState();
  ui.setDialog(null);
  try {
    const created = await backend.createFolder(files.activeTab().path, name);
    const createdName = created.split(/[\\/]/).pop() ?? name;
    ui.pushToast("ok", t("toast.created", { name: createdName }));
    await files.refresh();
    files.setSelection([created]);
  } catch (e) {
    ui.pushToast("error", t("toast.createFailed", { error: String(e) }));
  }
}

export function startRename(path?: string) {
  const files = useFiles.getState();
  const sel = files.activeTab().selection;
  // Vários selecionados + F2 = renomear em lote (um só = inline).
  if (!path && sel.length > 1) {
    askBatchRename();
    return;
  }
  const target = path ?? sel[0];
  if (target) files.setRenaming(target);
}

export function askBatchRename() {
  const sel = useFiles.getState().activeTab().selection;
  if (sel.length < 2) return;
  useUi.getState().setDialog({ kind: "batchRename", paths: sel });
}

export async function confirmRename(path: string, newName: string) {
  const ui = useUi.getState();
  const files = useFiles.getState();
  files.setRenaming(null);
  const oldName = path.split(/[\\/]/).pop() ?? "";
  if (!newName.trim() || newName === oldName) return;
  try {
    const renamed = await backend.renameEntry(path, newName);
    ui.pushToast("ok", t("toast.renamed", { name: newName }));
    await files.refresh();
    files.setSelection([renamed]);
  } catch (e) {
    ui.pushToast("error", t("toast.renameFailed", { error: String(e) }));
  }
}

export async function copyPathToClipboard(path: string) {
  const ui = useUi.getState();
  try {
    await navigator.clipboard.writeText(path);
    ui.pushToast("ok", t("toast.pathCopied"));
  } catch {
    ui.pushToast("error", t("toast.copyFailed"));
  }
}

export function showProperties(path: string) {
  const ui = useUi.getState();
  ui.setDialog({ kind: "properties", path, props: null });
  void backend
    .entryProperties(path)
    .then((props) => {
      const d = useUi.getState().dialog;
      if (d?.kind === "properties" && d.path === path) {
        ui.setDialog({ kind: "properties", path, props });
      }
    })
    .catch(() => {
      /* modal fechado ou caminho sumiu: ignora */
    });
}

export function selectAll() {
  const files = useFiles.getState();
  files.setSelection(files.visibleEntries().map((e) => e.path));
}
