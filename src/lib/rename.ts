/**
 * Lógica pura do renomear em lote (testável sem Tauri).
 *
 * Dois modos, como nos renomeadores clássicos:
 * - "replace": localizar/substituir no NOME (sem a extensão), com regex opcional;
 * - "pattern": template com {nome} (stem original) e {n} (contador), extensão
 *   original preservada.
 */

export type BatchMode = "replace" | "pattern";

export interface BatchOptions {
  mode: BatchMode;
  find: string;
  replace: string;
  regex: boolean;
  pattern: string;
  start: number;
}

export interface BatchItem {
  name: string;
  isDir: boolean;
}

export interface BatchPreview {
  newName: string;
  changed: boolean;
  /** Colisão com outro resultado do lote ou nome inválido. */
  conflict: boolean;
}

function splitName(name: string, isDir: boolean): { stem: string; ext: string } {
  if (isDir) return { stem: name, ext: "" };
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

const INVALID = /[\\/<>:"|?*]/;

export function isValidName(name: string): boolean {
  const t = name.trim();
  return t.length > 0 && t !== "." && t !== ".." && !INVALID.test(t) && !t.endsWith(".");
}

/** Aplica as opções a todos os itens; marca conflitos (duplicado/inválido). */
export function batchPreview(items: BatchItem[], opts: BatchOptions): BatchPreview[] {
  let counter = opts.start;
  const out: BatchPreview[] = items.map((item) => {
    const { stem, ext } = splitName(item.name, item.isDir);
    let newStem = stem;
    if (opts.mode === "replace") {
      if (opts.find) {
        try {
          const re = opts.regex
            ? new RegExp(opts.find, "g")
            : new RegExp(opts.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
          newStem = stem.replace(re, opts.replace);
        } catch {
          newStem = stem; // regex inválida enquanto digita: sem mudança
        }
      }
    } else {
      newStem = opts.pattern
        .split("{nome}")
        .join(stem)
        .split("{n}")
        .join(String(counter));
      counter += 1;
    }
    const newName = (newStem + ext).trim();
    return {
      newName,
      changed: newName !== item.name,
      conflict: !isValidName(newName),
    };
  });

  // Colisões dentro do próprio lote (case-insensitive, pensando no Windows).
  const seen = new Map<string, number[]>();
  out.forEach((p, i) => {
    const key = p.newName.toLowerCase();
    seen.set(key, [...(seen.get(key) ?? []), i]);
  });
  for (const idxs of seen.values()) {
    if (idxs.length > 1) for (const i of idxs) out[i].conflict = true;
  }
  return out;
}
