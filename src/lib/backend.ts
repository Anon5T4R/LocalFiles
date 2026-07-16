import { invoke } from "@tauri-apps/api/core";
import type { Drive, Entry, KnownFolder, Properties } from "./types";

/** Wrappers finos dos comandos Rust (nomes/formatos em um lugar só). */

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

export function renameEntry(path: string, newName: string): Promise<string> {
  return invoke("rename_entry", { path, newName });
}

export function deleteToTrash(paths: string[]): Promise<void> {
  return invoke("delete_to_trash", { paths });
}

export function startTransfer(sources: string[], destDir: string, isMove: boolean): Promise<number> {
  return invoke("start_transfer", { sources, destDir, isMove });
}

export function cancelTransfer(opId: number): Promise<void> {
  return invoke("cancel_transfer", { opId });
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
