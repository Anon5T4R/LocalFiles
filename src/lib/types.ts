/** Espelho dos structs do Rust (serde camelCase). */

export interface Entry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modifiedMs: number;
  ext: string;
  hidden: boolean;
  readonly: boolean;
  isSymlink: boolean;
}

export interface Drive {
  name: string;
  mount: string;
  total: number;
  available: number;
  removable: boolean;
}

export interface KnownFolder {
  id: string;
  path: string;
}

export interface OpProgress {
  opId: number;
  doneFiles: number;
  totalFiles: number;
  doneBytes: number;
  totalBytes: number;
  current: string;
}

export interface OpDone {
  opId: number;
  ok: boolean;
  canceled: boolean;
  error: string | null;
  created: string[];
}

export interface Properties {
  path: string;
  isDir: boolean;
  size: number;
  files: number;
  folders: number;
  modifiedMs: number;
  readonly: boolean;
  hidden: boolean;
  truncated: boolean;
}

export type ViewMode = "details" | "list" | "grid";
export type SortBy = "name" | "size" | "modified" | "type";
export type SortDir = "asc" | "desc";

export interface Tab {
  id: number;
  path: string;
  history: string[];
  histIndex: number;
  entries: Entry[];
  loading: boolean;
  error: string | null;
  selection: string[];
  anchor: number | null;
}

export interface ClipboardState {
  mode: "copy" | "cut";
  paths: string[];
}

export interface RunningOp {
  opId: number;
  isMove: boolean;
  progress: OpProgress | null;
}
