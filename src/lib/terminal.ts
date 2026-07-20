/**
 * Decisões do "Abrir no terminal", separadas da execução.
 *
 * Lição da v0.5.1 aplicada de novo: quando o caminho difícil depende do
 * ambiente (o LocalTerminal instalado ou não), separe a DECISÃO da EXECUÇÃO e
 * teste a decisão direto — senão o teste vira uma cópia da lógica que passa
 * verde com a produção quebrada.
 */

import { isVirtual } from "./apath";

export type TerminalTarget =
  | { ok: true; dir: string }
  | { ok: false; reason: "empty" | "inArchive" };

/**
 * A pasta serve pra abrir um terminal? Dentro de um compactado não existe
 * caminho de disco — extrair pro temporário e abrir ali mentiria sobre onde o
 * arquivo está (o `cd` do usuário não voltaria pro zip).
 */
export function terminalTarget(path: string | null | undefined): TerminalTarget {
  const p = (path ?? "").trim();
  if (!p) return { ok: false, reason: "empty" };
  if (isVirtual(p)) return { ok: false, reason: "inArchive" };
  return { ok: true, dir: p };
}

/**
 * Classifica o erro que o Rust devolveu. "Não instalado" é um resultado
 * ESPERADO (nem todo mundo tem o LocalTerminal) e merece aviso com instrução,
 * não um toast vermelho de falha.
 */
export function terminalErrorKind(err: unknown): "notInstalled" | "failed" {
  const msg = typeof err === "string" ? err : String((err as Error)?.message ?? err);
  return msg.includes("TERMINAL_NOT_INSTALLED") ? "notInstalled" : "failed";
}
