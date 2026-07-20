import { openPath } from "@tauri-apps/plugin-opener";
import * as backend from "./backend";
import { isSupportedArchive, isVirtual, joinVirtual, splitVirtual } from "./apath";
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
  // Arquivo compactado: ENTRA nele como se fosse pasta (o pedido do item B4).
  // Quem quiser abrir no app padrão tem o "Abrir com…" do menu de contexto —
  // e é por isso que esse item continua existindo pra arquivo compactado.
  if (!isVirtual(entry.path) && isSupportedArchive(entry.path)) {
    void files.navigate(joinVirtual(entry.path, ""));
    return;
  }
  // Item DENTRO de um arquivo: não há caminho de disco pra entregar ao SO.
  // Extrair pro temporário e abrir dali seria mentir sobre onde o arquivo está
  // (editar não voltaria pro zip), então a UI diz o que fazer em vez de fingir.
  if (isVirtual(entry.path)) {
    useUi.getState().pushToast("info", t("arch.extractFirst"));
    return;
  }
  // Arquivo comum: app padrão do SO (respeita as associações do Hub).
  openPath(entry.path).catch((e) =>
    useUi.getState().pushToast("error", t("toast.openFailed", { error: String(e) })),
  );
}

/** Abre o arquivo compactado no app padrão (o LocalZip, normalmente). */
export function openArchiveExternally(path: string) {
  openPath(path).catch((e) =>
    useUi.getState().pushToast("error", t("toast.openFailed", { error: String(e) })),
  );
}

/** Extrai a seleção (que está dentro de um arquivo) pro outro painel. */
export function extractSelection() {
  const files = useFiles.getState();
  const sel = files.activeTab().selection;
  if (sel.length === 0) return;
  if (!files.dual) {
    useUi.getState().pushToast("info", t("arch.needDualToExtract"));
    return;
  }
  void files.transferToOtherPane(false);
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
  // Excluir DENTRO de um arquivo compactado é trabalho do LocalZip (lá o
  // `remove` já existe e reconstrói sem re-extrair). Aqui a lixeira do SO não
  // alcança um item que não tem caminho de disco.
  if (paths.some(isVirtual)) {
    ui.pushToast("error", t("arch.noDelete"));
    return;
  }
  try {
    await backend.deleteToTrash(paths);
    useFiles.getState().forgetTags(paths); // etiqueta de item que sumiu não fica
    ui.pushToast("ok", t("toast.deleted", { n: paths.length }));
  } catch (e) {
    ui.pushToast("error", t("toast.deleteFailed", { error: String(e) }));
  }
  await useFiles.getState().refresh();
}

export function askNewFolder() {
  useUi.getState().setDialog({ kind: "newFolder" });
}

export function askNewFile() {
  useUi.getState().setDialog({ kind: "newFile" });
}

export async function confirmNewFolder(name: string) {
  await createEntry(name, false);
}

export async function confirmNewFile(name: string) {
  await createEntry(name, true);
}

async function createEntry(name: string, file: boolean) {
  const ui = useUi.getState();
  const files = useFiles.getState();
  ui.setDialog(null);
  try {
    const dir = files.activeTab().path;
    const created = file
      ? await backend.createFile(dir, name)
      : await backend.createFolder(dir, name);
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
  if (isVirtual(path)) {
    ui.pushToast("error", t("arch.noRename"));
    return;
  }
  try {
    const renamed = await backend.renameEntry(path, newName);
    // A etiqueta segue o arquivo (inclusive a dos filhos, se era pasta).
    files.movedTags(path, renamed);
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

/** Abre o diálogo de etiquetas pra seleção atual. */
export function askTags(paths?: string[]) {
  const files = useFiles.getState();
  const sel = paths ?? files.activeTab().selection;
  if (sel.length === 0) return;
  useUi.getState().setDialog({ kind: "tags", paths: sel });
}

/** Copia/move a seleção pro painel de trás (o gesto central do painel duplo). */
export function transferToOtherPane(isMove: boolean) {
  void useFiles.getState().transferToOtherPane(isMove);
}

/** O caminho aponta pra dentro de um arquivo compactado? (reexport pra UI) */
export { isVirtual, splitVirtual, isSupportedArchive };
