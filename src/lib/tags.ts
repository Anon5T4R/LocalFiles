/**
 * Etiquetas de arquivo (marcadores por conteúdo, não por lugar).
 *
 * # Onde isso mora, e por quê
 *
 * No `localStorage`, indexado pelo caminho — o mesmo lugar dos favoritos, que
 * já funcionavam assim desde a v0.2. Não é banco nem arquivo lateral porque
 * etiqueta é preferência de quem usa, não dado do arquivo: nada aqui altera um
 * byte do disco, e apagar o app não deixa sujeira em pasta nenhuma.
 *
 * O preço honesto disso: **renomear ou mover um arquivo por FORA do LocalFiles
 * perde a etiqueta** (o índice é por caminho). Renomear/mover DENTRO do app
 * carrega a etiqueta junto — é o que o [`retagPath`] faz.
 *
 * # Comparação de caminho
 *
 * A chave é o caminho normalizado em minúsculas no Windows (onde `C:\A.txt` e
 * `c:\a.txt` são o MESMO arquivo) e sensível a maiúsculas no resto. Sem isso,
 * etiquetar por um caminho e navegar por outro mostraria o arquivo sem etiqueta.
 */

const TAGS_KEY = "localfiles.tags";

/** Mapa caminho-normalizado → etiquetas (em ordem de inserção). */
export type TagMap = Record<string, string[]>;

/** Caminho Windows? (mesma heurística do `fsutil.sepOf`.) */
function isWindowsPath(p: string): boolean {
  return /^[a-zA-Z]:[\\/]|^\\\\/.test(p);
}

/** Chave de comparação: no Windows o caminho não distingue maiúsculas. */
export function tagKey(path: string): string {
  const p = path.replace(/[\\/]+$/, "");
  return isWindowsPath(p) ? p.toLowerCase() : p;
}

/** Etiqueta normalizada: sem espaços nas pontas, sem vazia, no máximo 24 chars. */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, 24);
}

export function loadTags(): TagMap {
  try {
    const raw = localStorage.getItem(TAGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: TagMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      // Só entra o que tem forma de etiqueta: nada de confiar no que estava lá.
      if (!Array.isArray(v)) continue;
      const list = v.filter((x): x is string => typeof x === "string" && x !== "");
      if (list.length > 0) out[k] = [...new Set(list)];
    }
    return out;
  } catch {
    return {}; // valor corrompido: começa do zero em vez de derrubar o app
  }
}

export function saveTags(map: TagMap) {
  try {
    localStorage.setItem(TAGS_KEY, JSON.stringify(map));
  } catch {
    /* cota estourada / storage indisponível: etiqueta é conforto, não requisito */
  }
}

export function tagsOf(map: TagMap, path: string): string[] {
  return map[tagKey(path)] ?? [];
}

/** Liga/desliga uma etiqueta num caminho. Devolve o mapa NOVO (imutável). */
export function toggleTag(map: TagMap, path: string, rawTag: string): TagMap {
  const tag = normalizeTag(rawTag);
  if (!tag) return map;
  const key = tagKey(path);
  const cur = map[key] ?? [];
  const next = cur.includes(tag) ? cur.filter((x) => x !== tag) : [...cur, tag];
  const out = { ...map };
  if (next.length === 0) delete out[key];
  else out[key] = next;
  return out;
}

/** Aplica uma etiqueta a VÁRIOS caminhos de uma vez (menu de contexto). */
export function setTagOn(map: TagMap, paths: string[], rawTag: string, on: boolean): TagMap {
  const tag = normalizeTag(rawTag);
  if (!tag) return map;
  const out = { ...map };
  for (const p of paths) {
    const key = tagKey(p);
    const cur = out[key] ?? [];
    const next = on ? (cur.includes(tag) ? cur : [...cur, tag]) : cur.filter((x) => x !== tag);
    if (next.length === 0) delete out[key];
    else out[key] = next;
  }
  return out;
}

/** Todas as etiquetas existentes, ordenadas, com quantos arquivos cada uma tem. */
export function allTags(map: TagMap): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const list of Object.values(map)) {
    for (const t of list) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => collator.compare(a.tag, b.tag));
}

/**
 * Leva as etiquetas de um caminho pro novo depois de renomear/mover DENTRO do
 * app. Move também as dos DESCENDENTES quando o que mudou foi uma pasta —
 * senão renomear uma pasta apagaria a etiqueta de tudo que está nela.
 */
export function retagPath(map: TagMap, from: string, to: string): TagMap {
  const oldKey = tagKey(from);
  const newKey = tagKey(to);
  if (oldKey === newKey) return map;
  const out: TagMap = {};
  let mudou = false;
  for (const [k, v] of Object.entries(map)) {
    if (k === oldKey) {
      out[newKey] = v;
      mudou = true;
    } else if (k.startsWith(oldKey + "\\") || k.startsWith(oldKey + "/")) {
      out[newKey + k.slice(oldKey.length)] = v;
      mudou = true;
    } else {
      out[k] = v;
    }
  }
  return mudou ? out : map;
}

/** Esquece as etiquetas de caminhos que saíram (excluídos). */
export function forgetPaths(map: TagMap, paths: string[]): TagMap {
  const keys = paths.map(tagKey);
  const out: TagMap = {};
  let mudou = false;
  for (const [k, v] of Object.entries(map)) {
    const foi = keys.some((p) => k === p || k.startsWith(p + "\\") || k.startsWith(p + "/"));
    if (foi) mudou = true;
    else out[k] = v;
  }
  return mudou ? out : map;
}
