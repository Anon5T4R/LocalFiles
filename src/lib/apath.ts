/**
 * Caminhos VIRTUAIS: um lugar dentro de um arquivo compactado.
 *
 * `C:\docs\fotos.zip::praia/verao.jpg` = o arquivo `praia/verao.jpg` dentro do
 * zip `C:\docs\fotos.zip`. O separador é `::` (duas letras) porque um caminho
 * do Windows já tem um `:` — a unidade — e um só seria ambíguo.
 *
 * **Este arquivo é o espelho do que o `archive.rs` faz no Rust.** As duas
 * pontas precisam concordar byte a byte no formato do caminho, então o teste
 * `apath.test.ts` repete os mesmos casos do teste `caminho_virtual_vai_e_volta`
 * do Rust de propósito.
 *
 * A lista de extensões vem do `zpath.ts` do LocalZip (v0.5.0), com o mesmo
 * cuidado com as TRÊS famílias de "arquivo dividido", que são coisas
 * diferentes: `foo.zip.001` (corte cru, vale pra qualquer formato),
 * `foo.part2.rar` (multivolume do próprio RAR) e `foo.r07` (a numeração antiga
 * do RAR, que nem termina em `.rar`).
 */

export const VSEP = "::";

/** Um lugar dentro de um arquivo: o arquivo no disco + a pasta/item interno. */
export interface VPath {
  /** Caminho do arquivo compactado no disco. */
  archive: string;
  /** Caminho interno, "/" como separador, sem barras nas pontas ("" = raiz). */
  inner: string;
}

/** Normaliza um caminho interno (mesma regra do `norm_inner` do Rust). */
export function normInner(raw: string): string {
  return raw.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+|\/+$/g, "");
}

/** Quebra um caminho virtual, ou `null` se for caminho de disco comum. */
export function splitVirtual(path: string): VPath | null {
  const i = path.indexOf(VSEP);
  if (i < 0) return null;
  return { archive: path.slice(0, i), inner: normInner(path.slice(i + VSEP.length)) };
}

export function joinVirtual(archive: string, inner: string): string {
  return `${archive}${VSEP}${normInner(inner)}`;
}

/** O caminho está dentro de um arquivo compactado? */
export function isVirtual(path: string): boolean {
  return path.includes(VSEP);
}

/**
 * Pai de um caminho virtual. Subir da raiz do arquivo devolve a PASTA DO DISCO
 * onde o arquivo mora — sair do zip pelo "voltar" tem que dar no lugar certo,
 * não num beco sem saída.
 */
export function parentVirtual(path: string): string | null {
  const v = splitVirtual(path);
  if (!v) return null;
  if (v.inner === "") {
    // Raiz do arquivo → a pasta que contém o arquivo, no disco.
    const idx = Math.max(v.archive.lastIndexOf("\\"), v.archive.lastIndexOf("/"));
    if (idx <= 0) return null;
    const parent = v.archive.slice(0, idx);
    return /^[a-zA-Z]:$/.test(parent) ? parent + "\\" : parent || "/";
  }
  const cut = v.inner.lastIndexOf("/");
  return joinVirtual(v.archive, cut < 0 ? "" : v.inner.slice(0, cut));
}

/**
 * Segmentos de breadcrumb de um caminho virtual: a parte do disco (até o
 * arquivo) fica a cargo do chamador; aqui saem só os pedaços internos.
 */
export function innerCrumbs(path: string): { name: string; path: string }[] {
  const v = splitVirtual(path);
  if (!v || v.inner === "") return [];
  const out: { name: string; path: string }[] = [];
  let acc = "";
  for (const part of v.inner.split("/")) {
    acc = acc === "" ? part : `${acc}/${part}`;
    out.push({ name: part, path: joinVirtual(v.archive, acc) });
  }
  return out;
}

/**
 * O caminho de disco parece um arquivo compactado que a gente sabe abrir?
 *
 * Herdado do `isSupportedArchive` do LocalZip. O `.z01` (zip multi-disco de
 * verdade) fica de fora aqui de propósito: o LocalZip abre pra explicar por que
 * não dá, mas num gerenciador de arquivos "entrar e dar erro" é pior do que
 * simplesmente abrir no app padrão.
 */
export function isSupportedArchive(path: string): boolean {
  // Sufixo de volume de corte cru (3+ dígitos) não muda o formato: tira e segue.
  const l = path.toLowerCase().replace(/\.\d{3,}$/, "");
  return (
    l.endsWith(".zip") ||
    l.endsWith(".rar") ||
    /\.r\d{2}$/.test(l) ||
    l.endsWith(".7z") ||
    l.endsWith(".tar") ||
    /\.(tar\.gz|tgz|tar\.xz|txz|tar\.bz2|tbz2|tbz|tar\.zst|tzst)$/.test(l)
  );
}

/**
 * Pra onde vai uma transferência, dado de onde vem e pra onde vai.
 *
 * Quatro combinações, e a decisão é puramente sobre os CAMINHOS — por isso
 * mora aqui, longe do store, e é testada sozinha. Errar aqui não dá erro: dá a
 * operação errada silenciosamente (extrair quando devia adicionar, por
 * exemplo), que é o tipo de bug que só aparece com o arquivo do usuário na mão.
 */
export type Route =
  | { kind: "transfer" }
  | { kind: "extract"; archive: string; inners: string[] }
  | { kind: "add"; archive: string; innerDir: string }
  /** Recusado — `reason` é a chave de mensagem que a UI mostra. */
  | { kind: "refused"; reason: "zipToZip" | "mixedSources" | "readOnly" };

export function routeTransfer(sources: string[], destDir: string): Route {
  const destV = splitVirtual(destDir);
  const srcV = sources.map(splitVirtual);
  const algumaVirtual = srcV.some((v) => v !== null);
  const todasVirtuais = srcV.every((v) => v !== null);

  // De dentro de um arquivo pra dentro de outro: exigiria um temporário no
  // meio, e falhar ali deixaria o item em lugar nenhum. Recusa explícita.
  if (algumaVirtual && destV) return { kind: "refused", reason: "zipToZip" };
  // Origem misturada (parte no disco, parte num arquivo) seriam duas operações
  // com regras diferentes num "colar" só.
  if (algumaVirtual && !todasVirtuais) return { kind: "refused", reason: "mixedSources" };

  if (todasVirtuais && sources.length > 0) {
    const archive = srcV[0]!.archive;
    if (srcV.some((v) => v!.archive !== archive)) {
      return { kind: "refused", reason: "mixedSources" };
    }
    return { kind: "extract", archive, inners: srcV.map((v) => v!.inner) };
  }

  if (destV) {
    if (!isWritableArchive(destV.archive)) return { kind: "refused", reason: "readOnly" };
    return { kind: "add", archive: destV.archive, innerDir: destV.inner };
  }

  return { kind: "transfer" };
}

/**
 * Dá pra ESCREVER dentro deste arquivo? Só zip, e só quando não é um conjunto
 * de volumes (reescrever um corte cru exigiria re-picar tudo).
 *
 * Espelha as recusas `ADD_ONLY_ZIP` / `ADD_NOT_ON_SPLIT` do Rust — a UI usa
 * isso pra DESABILITAR o "colar" em vez de deixar clicar e falhar depois.
 */
export function isWritableArchive(archive: string): boolean {
  const l = archive.toLowerCase();
  if (/\.\d{3,}$/.test(l)) return false; // volume de corte cru
  return l.endsWith(".zip");
}
