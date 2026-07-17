import { invoke } from "@tauri-apps/api/core";
import type { Drive, Entry, KnownFolder, Properties, RenameResult, TextHead } from "./types";

/** Wrappers finos dos comandos Rust (nomes/formatos em um lugar só). */

/** Rodando dentro do Tauri? (o smoke em navegador puro não tem a ponte.) */
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function listDir(path: string, showHidden: boolean): Promise<Entry[]> {
  return invoke("list_dir", { path, showHidden });
}

export function listDrives(): Promise<Drive[]> {
  return invoke("list_drives");
}

export function knownFolders(): Promise<KnownFolder[]> {
  return invoke("known_folders");
}

export function createFolder(parent: string, name: string): Promise<string> {
  return invoke("create_folder", { parent, name });
}

export function createFile(parent: string, name: string): Promise<string> {
  return invoke("create_file", { parent, name });
}

export function renameEntry(path: string, newName: string): Promise<string> {
  return invoke("rename_entry", { path, newName });
}

export function deleteToTrash(paths: string[]): Promise<void> {
  return invoke("delete_to_trash", { paths });
}

export function startTransfer(sources: string[], destDir: string, isMove: boolean): Promise<number> {
  return invoke("start_transfer", { sources, destDir, isMove });
}

/** Cancela qualquer operação (transferência ou busca). */
export function cancelOp(opId: number): Promise<void> {
  return invoke("cancel_op", { opId });
}

export function entryProperties(path: string): Promise<Properties> {
  return invoke("entry_properties", { path });
}

export function openWithDialog(path: string): Promise<void> {
  return invoke("open_with_dialog", { path });
}

export function getStartupDir(): Promise<string | null> {
  return invoke("get_startup_dir");
}

// ---------- v0.2 ----------

export function startSearch(
  root: string,
  query: string,
  inContent: boolean,
  showHidden: boolean,
): Promise<number> {
  return invoke("start_search", { root, query, inContent, showHidden });
}

export function watchDir(path: string): Promise<void> {
  return invoke("watch_dir", { path });
}

export function batchRename(items: { path: string; newName: string }[]): Promise<RenameResult[]> {
  return invoke("batch_rename", { items });
}

export function thumbnail(path: string, maxDim: number): Promise<string | null> {
  return invoke("thumbnail", { path, maxDim });
}

export function readTextHead(path: string, maxBytes: number): Promise<TextHead> {
  return invoke("read_text_head", { path, maxBytes });
}
