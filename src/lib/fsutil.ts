import type { Entry, SortBy, SortDir } from "./types";

/** Separador do SO (heurística: caminho Windows tem "X:\" ou "\\"). */
export function sepOf(path: string): "\\" | "/" {
  return /^[a-zA-Z]:[\\/]|^\\\\/.test(path) ? "\\" : "/";
}

/** Normaliza: barras coerentes e sem barra final (exceto raiz "C:\" ou "/"). */
export function normalizePath(path: string): string {
  const sep = sepOf(path);
  let p = sep === "\\" ? path.replace(/\//g, "\\") : path;
  while (p.length > 1 && (p.endsWith("\\") || p.endsWith("/")) && !/^[a-zA-Z]:[\\/]$/.test(p)) {
    p = p.slice(0, -1);
  }
  // Raiz de drive sempre com a barra ("C:" sozinho no Windows = cwd do drive).
  if (/^[a-zA-Z]:$/.test(p)) p += "\\";
  return p;
}

/** Pai do caminho, ou null se já é raiz. */
export function parentOf(path: string): string | null {
  const p = normalizePath(path);
  if (/^[a-zA-Z]:[\\/]$/.test(p) || p === "/") return null;
  const sep = sepOf(p);
  const idx = p.lastIndexOf(sep);
  if (idx < 0) return null;
  const parent = p.slice(0, idx);
  if (parent === "") return "/";
  if (/^[a-zA-Z]:$/.test(parent)) return parent + "\\";
  return parent;
}

/** Segmentos do breadcrumb: [{name, path}] da raiz até o caminho. */
export function breadcrumbOf(path: string): { name: string; path: string }[] {
  const p = normalizePath(path);
  const sep = sepOf(p);
  const out: { name: string; path: string }[] = [];
  if (sep === "\\") {
    const parts = p.split("\\").filter(Boolean);
    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      acc = i === 0 ? parts[0] + "\\" : acc + (acc.endsWith("\\") ? "" : "\\") + parts[i];
      out.push({ name: i === 0 ? parts[0] : parts[i], path: acc });
    }
  } else {
    out.push({ name: "/", path: "/" });
    const parts = p.split("/").filter(Boolean);
    let acc = "";
    for (const part of parts) {
      acc += "/" + part;
      out.push({ name: part, path: acc });
    }
  }
  return out;
}

export function joinPath(dir: string, name: string): string {
  const d = normalizePath(dir);
  const sep = sepOf(d);
  return d.endsWith(sep) ? d + name : d + sep + name;
}

/** Bytes legíveis (1 casa, unidades binárias como o Explorer). */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

/** Data curta no locale da UI (Intl faz a gramática por idioma). */
export function formatDate(ms: number, localeTag: string): string {
  if (!ms) return "—";
  return new Intl.DateTimeFormat(localeTag, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(ms));
}

/** Ordena: pastas sempre antes de arquivos; dentro do grupo, o critério. */
export function sortEntries(entries: Entry[], by: SortBy, dir: SortDir): Entry[] {
  const mul = dir === "asc" ? 1 : -1;
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const byName = (a: Entry, b: Entry) => collator.compare(a.name, b.name);
  const cmp = (a: Entry, b: Entry): number => {
    switch (by) {
      case "size":
        return a.size - b.size || byName(a, b);
      case "modified":
        return a.modifiedMs - b.modifiedMs || byName(a, b);
      case "type":
        return collator.compare(a.ext, b.ext) || byName(a, b);
      default:
        return byName(a, b);
    }
  };
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return mul * cmp(a, b);
  });
}

/** Grupo visual do arquivo (decide o ícone). */
export type FileKind =
  | "folder"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sheet"
  | "slides"
  | "pdf"
  | "archive"
  | "code"
  | "exe"
  | "file";

const KIND_BY_EXT: Record<string, FileKind> = {};
function reg(kind: FileKind, exts: string[]) {
  for (const e of exts) KIND_BY_EXT[e] = kind;
}
reg("image", ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "tiff", "avif", "heic"]);
reg("video", ["mp4", "mkv", "webm", "avi", "mov", "wmv", "flv", "m4v", "mpg", "mpeg", "ts"]);
reg("audio", ["mp3", "flac", "wav", "ogg", "m4a", "aac", "wma", "opus", "mid"]);
reg("document", ["doc", "docx", "odt", "rtf", "txt", "md", "tex", "epub", "pages"]);
reg("sheet", ["xls", "xlsx", "ods", "csv", "tsv", "numbers"]);
reg("slides", ["ppt", "pptx", "odp", "key", "tslides"]);
reg("pdf", ["pdf"]);
reg("archive", ["zip", "7z", "rar", "tar", "gz", "xz", "bz2", "tgz", "zst", "iso", "cab"]);
reg("code", [
  "js", "ts", "tsx", "jsx", "rs", "py", "java", "c", "h", "cpp", "hpp", "cs", "go",
  "rb", "php", "sh", "ps1", "bat", "cmd", "json", "yaml", "yml", "toml", "xml",
  "html", "css", "scss", "sql", "lua", "kt", "swift", "dart", "vue",
]);
reg("exe", ["exe", "msi", "appimage", "deb", "rpm", "apk", "dmg", "com", "scr"]);

export function kindOf(entry: { isDir: boolean; ext: string }): FileKind {
  if (entry.isDir) return "folder";
  return KIND_BY_EXT[entry.ext] ?? "file";
}

export const KIND_ICON: Record<FileKind, string> = {
  folder: "📁",
  image: "🖼️",
  video: "🎬",
  audio: "🎵",
  document: "📝",
  sheet: "📊",
  slides: "📽️",
  pdf: "📕",
  archive: "🗜️",
  code: "⌨️",
  exe: "⚙️",
  file: "📄",
};

/** Sugestão de nome livre entre os existentes: "Nome", "Nome (2)", … */
export function uniqueName(base: string, existing: Set<string>): string {
  if (!existing.has(base.toLowerCase())) return base;
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!existing.has(candidate.toLowerCase())) return candidate;
  }
}
