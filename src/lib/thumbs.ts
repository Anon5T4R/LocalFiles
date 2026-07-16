import { isTauri, thumbnail } from "./backend";

/**
 * Cache/fila de miniaturas no front: no máximo 4 pedidos simultâneos ao Rust
 * (rolar uma grade grande não pode disparar 200 decodes de uma vez) e um
 * Map em memória pra não re-pedir o que já veio.
 */

const cache = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();
const queue: (() => void)[] = [];
let active = 0;
const MAX_ACTIVE = 4;

function pump() {
  while (active < MAX_ACTIVE && queue.length > 0) {
    queue.shift()!();
  }
}

export function getThumb(path: string, maxDim: number): Promise<string | null> {
  if (!isTauri) return Promise.resolve(null);
  const key = `${path}|${maxDim}`;
  const hit = cache.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  const inflight = pending.get(key);
  if (inflight) return inflight;

  const p = new Promise<string | null>((resolve) => {
    queue.push(() => {
      active += 1;
      thumbnail(path, maxDim)
        .catch(() => null)
        .then((url) => {
          cache.set(key, url);
          pending.delete(key);
          active -= 1;
          pump();
          resolve(url);
        });
    });
    pump();
  });
  pending.set(key, p);
  return p;
}

/** Limpa o cache (troca de pasta grande / refresh manual). */
export function dropThumbCache() {
  cache.clear();
}
