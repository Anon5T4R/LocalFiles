import { describe, expect, it } from "vitest";
import {
  innerCrumbs,
  isSupportedArchive,
  isVirtual,
  isWritableArchive,
  joinVirtual,
  normInner,
  parentVirtual,
  routeTransfer,
  splitVirtual,
} from "../apath";

/**
 * Estes casos são o ESPELHO do teste `caminho_virtual_vai_e_volta` do
 * `archive.rs`. As duas pontas têm que concordar no formato do caminho: se o
 * front montar um caminho que o Rust não sabe quebrar, o zip abre vazio sem
 * erro nenhum — o pior tipo de falha.
 */
describe("caminho virtual", () => {
  it("vai e volta, igual ao Rust", () => {
    const v = joinVirtual("C:\\x\\a.zip", "fotos/praia.jpg");
    expect(v).toBe("C:\\x\\a.zip::fotos/praia.jpg");
    expect(splitVirtual(v)).toEqual({ archive: "C:\\x\\a.zip", inner: "fotos/praia.jpg" });
  });

  it("raiz do arquivo tem inner vazio", () => {
    expect(splitVirtual("C:\\x\\a.zip::")).toEqual({ archive: "C:\\x\\a.zip", inner: "" });
    expect(joinVirtual("C:\\x\\a.zip", "")).toBe("C:\\x\\a.zip::");
  });

  it("caminho de disco comum NÃO é virtual (a unidade tem só um ':')", () => {
    expect(splitVirtual("C:\\x\\a.zip")).toBeNull();
    expect(splitVirtual("/home/joao/a.zip")).toBeNull();
    expect(isVirtual("C:\\x\\a.zip")).toBe(false);
    expect(isVirtual("C:\\x\\a.zip::docs")).toBe(true);
  });

  it("normaliza o interno como o `norm_inner` do Rust", () => {
    expect(normInner("./a/b/")).toBe("a/b");
    expect(normInner("a\\b\\c")).toBe("a/b/c");
    expect(normInner("/abs/x")).toBe("abs/x");
    expect(normInner("")).toBe("");
  });
});

describe("subir de nível", () => {
  it("dentro do arquivo sobe pela árvore interna", () => {
    expect(parentVirtual("C:\\x\\a.zip::docs/sub/f.txt")).toBe("C:\\x\\a.zip::docs/sub");
    expect(parentVirtual("C:\\x\\a.zip::docs/sub")).toBe("C:\\x\\a.zip::docs");
    expect(parentVirtual("C:\\x\\a.zip::docs")).toBe("C:\\x\\a.zip::");
  });

  it("da RAIZ do arquivo sai pro disco — não é beco sem saída", () => {
    // É o comportamento que o Backspace/↑ precisa ter: subir de dentro do zip
    // tem que dar na pasta onde o zip mora, não travar na raiz do arquivo.
    expect(parentVirtual("C:\\x\\a.zip::")).toBe("C:\\x");
    expect(parentVirtual("C:\\a.zip::")).toBe("C:\\");
    expect(parentVirtual("/home/joao/a.zip::")).toBe("/home/joao");
  });

  it("caminho de disco devolve null (quem cuida é o parentOf)", () => {
    expect(parentVirtual("C:\\x\\y")).toBeNull();
  });
});

describe("breadcrumb interno", () => {
  it("acumula os segmentos", () => {
    expect(innerCrumbs("C:\\a.zip::docs/sub/f.txt")).toEqual([
      { name: "docs", path: "C:\\a.zip::docs" },
      { name: "sub", path: "C:\\a.zip::docs/sub" },
      { name: "f.txt", path: "C:\\a.zip::docs/sub/f.txt" },
    ]);
  });

  it("raiz do arquivo não tem segmento interno", () => {
    expect(innerCrumbs("C:\\a.zip::")).toEqual([]);
    expect(innerCrumbs("C:\\pasta")).toEqual([]);
  });
});

describe("formatos reconhecidos", () => {
  it("aceita as famílias que o motor lê", () => {
    for (const p of [
      "a.zip",
      "a.ZIP",
      "a.rar",
      "a.7z",
      "a.tar",
      "a.tar.gz",
      "a.tgz",
      "a.tar.xz",
      "a.tar.bz2",
      "a.tar.zst",
    ]) {
      expect(isSupportedArchive(`C:\\x\\${p}`), p).toBe(true);
    }
  });

  it("volume de corte cru mantém o formato do nome de baixo", () => {
    // `foo.zip.001` é zip; o sufixo numérico não muda nada (regra do LocalZip).
    expect(isSupportedArchive("C:\\x\\foo.zip.001")).toBe(true);
    expect(isSupportedArchive("C:\\x\\foo.tar.gz.002")).toBe(true);
  });

  it("numeração antiga do RAR não termina em .rar e mesmo assim conta", () => {
    expect(isSupportedArchive("C:\\x\\foo.r07")).toBe(true);
    expect(isSupportedArchive("C:\\x\\foo.r7")).toBe(false); // 1 dígito não é volume
  });

  it("recusa o que não é arquivo compactado", () => {
    for (const p of ["a.txt", "a.png", "a.zipper", "a.exe", "pasta"]) {
      expect(isSupportedArchive(`C:\\x\\${p}`), p).toBe(false);
    }
  });
});

describe("dá pra escrever dentro?", () => {
  it("só zip inteiro — o resto é só leitura", () => {
    // Espelha as recusas ADD_ONLY_ZIP / ADD_NOT_ON_SPLIT do Rust: a UI usa isso
    // pra DESABILITAR o colar em vez de deixar clicar e falhar depois.
    expect(isWritableArchive("C:\\x\\a.zip")).toBe(true);
    expect(isWritableArchive("C:\\x\\A.ZIP")).toBe(true);
    expect(isWritableArchive("C:\\x\\a.7z")).toBe(false);
    expect(isWritableArchive("C:\\x\\a.rar")).toBe(false);
    expect(isWritableArchive("C:\\x\\a.tar.gz")).toBe(false);
    // Zip dividido em volumes: reescrever exigiria re-picar tudo.
    expect(isWritableArchive("C:\\x\\a.zip.001")).toBe(false);
  });
});

describe("pra onde vai a transferência", () => {
  const ZIP = "C:\\x\\a.zip";
  const OUTRO = "C:\\x\\b.zip";

  it("disco → disco é a operação de sempre", () => {
    expect(routeTransfer(["C:\\a.txt"], "D:\\destino")).toEqual({ kind: "transfer" });
  });

  it("de dentro do arquivo pro disco = EXTRAIR (e leva os caminhos internos)", () => {
    expect(routeTransfer([`${ZIP}::docs/a.txt`, `${ZIP}::fotos`], "D:\\saida")).toEqual({
      kind: "extract",
      archive: ZIP,
      inners: ["docs/a.txt", "fotos"],
    });
  });

  it("do disco pra dentro do zip = ADICIONAR, na pasta interna certa", () => {
    expect(routeTransfer(["C:\\a.txt"], `${ZIP}::docs/sub`)).toEqual({
      kind: "add",
      archive: ZIP,
      innerDir: "docs/sub",
    });
    // Na raiz do arquivo, a pasta interna é vazia.
    expect(routeTransfer(["C:\\a.txt"], `${ZIP}::`)).toEqual({
      kind: "add",
      archive: ZIP,
      innerDir: "",
    });
  });

  it("zip → zip é RECUSADO (falhar no meio deixaria o item em lugar nenhum)", () => {
    expect(routeTransfer([`${ZIP}::a.txt`], `${OUTRO}::`)).toEqual({
      kind: "refused",
      reason: "zipToZip",
    });
    // Inclusive pro MESMO arquivo — não é caso de "otimizar", é caso de recusar.
    expect(routeTransfer([`${ZIP}::a.txt`], `${ZIP}::docs`)).toEqual({
      kind: "refused",
      reason: "zipToZip",
    });
  });

  it("origem misturada é recusada — disco e zip juntos, ou dois zips", () => {
    expect(routeTransfer(["C:\\a.txt", `${ZIP}::b.txt`], "D:\\saida")).toEqual({
      kind: "refused",
      reason: "mixedSources",
    });
    expect(routeTransfer([`${ZIP}::a.txt`, `${OUTRO}::b.txt`], "D:\\saida")).toEqual({
      kind: "refused",
      reason: "mixedSources",
    });
  });

  it("destino só-leitura é recusado ANTES de tentar (não deixa clicar e falhar)", () => {
    for (const alvo of ["C:\\x\\a.7z", "C:\\x\\a.rar", "C:\\x\\a.tar.gz", "C:\\x\\a.zip.001"]) {
      expect(routeTransfer(["C:\\a.txt"], `${alvo}::`), alvo).toEqual({
        kind: "refused",
        reason: "readOnly",
      });
    }
  });
});
