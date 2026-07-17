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
  /** Âncora fixa do Shift+clique/setas. */
  anchor: number | null;
  /** Ponta móvel da seleção por teclado (setas). */
  focusIdx: number | null;
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

// ---------- v0.2 ----------

export interface TextHead {
  text: string;
  truncated: boolean;
}

export interface RenameResult {
  ok: boolean;
  newPath: string | null;
  error: string | null;
}

export interface SearchBatch {
  opId: number;
  entries: Entry[];
}

export interface SearchDone {
  opId: number;
  total: number;
  truncated: boolean;
  canceled: boolean;
}

/** Busca ativa (substitui a listagem até fechar). */
export interface SearchState {
  root: string;
  query: string;
  inContent: boolean;
  running: boolean;
  /** Gerado no front (síncrono) e passado ao Rust — nunca null. */
  opId: number;
  results: Entry[];
  truncated: boolean;
}

export interface Favorite {
  name: string;
  path: string;
}
