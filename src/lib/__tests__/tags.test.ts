import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  allTags,
  forgetPaths,
  loadTags,
  normalizeTag,
  retagPath,
  saveTags,
  setTagOn,
  tagKey,
  tagsOf,
  toggleTag,
  type TagMap,
} from "../tags";

/**
 * O vitest da suíte roda em ambiente `node` (sem jsdom, de propósito: os
 * módulos testados são puros). O `localStorage` é o único pedaço de navegador
 * que o `tags.ts` toca, então ele ganha um dublê em memória aqui em vez de a
 * suíte inteira carregar um DOM.
 */
beforeAll(() => {
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, String(v)),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
    },
  });
});

describe("chave de comparação", () => {
  it("no Windows não distingue maiúsculas — é o MESMO arquivo", () => {
    // Sem isso, etiquetar por "C:\Docs\A.txt" e navegar por "c:\docs\a.txt"
    // mostraria o arquivo sem etiqueta nenhuma.
    expect(tagKey("C:\\Docs\\A.txt")).toBe(tagKey("c:\\docs\\a.txt"));
  });

  it("fora do Windows distingue (lá são arquivos diferentes de verdade)", () => {
    expect(tagKey("/home/joao/A.txt")).not.toBe(tagKey("/home/joao/a.txt"));
  });

  it("barra no fim não muda a identidade da pasta", () => {
    expect(tagKey("C:\\docs\\")).toBe(tagKey("C:\\docs"));
  });
});

describe("normalização da etiqueta", () => {
  it("apara, colapsa espaço e limita o tamanho", () => {
    expect(normalizeTag("  trabalho  ")).toBe("trabalho");
    expect(normalizeTag("a    b")).toBe("a b");
    expect(normalizeTag("")).toBe("");
    expect(normalizeTag("x".repeat(50))).toHaveLength(24);
  });
});

describe("ligar e desligar", () => {
  it("alterna, e a última etiqueta removida apaga a entrada inteira", () => {
    let m: TagMap = {};
    m = toggleTag(m, "C:\\a.txt", "urgente");
    expect(tagsOf(m, "C:\\a.txt")).toEqual(["urgente"]);
    m = toggleTag(m, "C:\\a.txt", "fiscal");
    expect(tagsOf(m, "C:\\a.txt")).toEqual(["urgente", "fiscal"]);
    m = toggleTag(m, "C:\\a.txt", "urgente");
    expect(tagsOf(m, "C:\\a.txt")).toEqual(["fiscal"]);
    m = toggleTag(m, "C:\\a.txt", "fiscal");
    // Sem etiqueta = sem entrada (nada de `{"c:\\a.txt": []}` acumulando).
    expect(Object.keys(m)).toHaveLength(0);
  });

  it("etiqueta vazia não entra", () => {
    const m = toggleTag({}, "C:\\a.txt", "   ");
    expect(Object.keys(m)).toHaveLength(0);
  });

  it("não duplica ao ligar duas vezes em lote", () => {
    let m = setTagOn({}, ["C:\\a.txt", "C:\\b.txt"], "foto", true);
    m = setTagOn(m, ["C:\\a.txt"], "foto", true);
    expect(tagsOf(m, "C:\\a.txt")).toEqual(["foto"]);
    expect(tagsOf(m, "C:\\b.txt")).toEqual(["foto"]);
  });

  it("é imutável (o estado antigo não muda)", () => {
    const antes: TagMap = { "c:\\a.txt": ["x"] };
    const depois = toggleTag(antes, "C:\\a.txt", "y");
    expect(antes["c:\\a.txt"]).toEqual(["x"]);
    expect(depois["c:\\a.txt"]).toEqual(["x", "y"]);
  });
});

describe("lista de etiquetas conhecidas", () => {
  it("conta os arquivos por etiqueta, em ordem", () => {
    let m = setTagOn({}, ["C:\\a.txt", "C:\\b.txt"], "zebra", true);
    m = setTagOn(m, ["C:\\a.txt"], "abacate", true);
    expect(allTags(m)).toEqual([
      { tag: "abacate", count: 1 },
      { tag: "zebra", count: 2 },
    ]);
  });
});

describe("renomear/mover leva a etiqueta junto", () => {
  it("arquivo simples", () => {
    const m = setTagOn({}, ["C:\\docs\\a.txt"], "fiscal", true);
    const depois = retagPath(m, "C:\\docs\\a.txt", "C:\\docs\\b.txt");
    expect(tagsOf(depois, "C:\\docs\\b.txt")).toEqual(["fiscal"]);
    expect(tagsOf(depois, "C:\\docs\\a.txt")).toEqual([]);
  });

  it("pasta leva os DESCENDENTES — senão renomear a pasta apagaria tudo", () => {
    let m = setTagOn({}, ["C:\\docs"], "projeto", true);
    m = setTagOn(m, ["C:\\docs\\nota.txt"], "urgente", true);
    m = setTagOn(m, ["C:\\docs\\sub\\fundo.txt"], "arquivo", true);
    // Um irmão de nome PARECIDO não pode ser arrastado junto.
    m = setTagOn(m, ["C:\\docs2\\outro.txt"], "intruso", true);

    const depois = retagPath(m, "C:\\docs", "C:\\documentos");
    expect(tagsOf(depois, "C:\\documentos")).toEqual(["projeto"]);
    expect(tagsOf(depois, "C:\\documentos\\nota.txt")).toEqual(["urgente"]);
    expect(tagsOf(depois, "C:\\documentos\\sub\\fundo.txt")).toEqual(["arquivo"]);
    expect(tagsOf(depois, "C:\\docs2\\outro.txt")).toEqual(["intruso"]);
    expect(tagsOf(depois, "C:\\docs\\nota.txt")).toEqual([]);
  });

  it("destino igual à origem não mexe em nada", () => {
    const m = setTagOn({}, ["C:\\a.txt"], "x", true);
    expect(retagPath(m, "C:\\a.txt", "c:\\A.TXT")).toBe(m);
  });
});

describe("esquecer o que foi excluído", () => {
  it("some com o item e com os filhos dele", () => {
    let m = setTagOn({}, ["C:\\docs\\a.txt"], "x", true);
    m = setTagOn(m, ["C:\\docs\\sub\\b.txt"], "y", true);
    m = setTagOn(m, ["C:\\outro.txt"], "z", true);
    const depois = forgetPaths(m, ["C:\\docs"]);
    expect(Object.keys(depois)).toEqual([tagKey("C:\\outro.txt")]);
  });

  it("nada a esquecer devolve o MESMO objeto (não redesenha à toa)", () => {
    const m = setTagOn({}, ["C:\\a.txt"], "x", true);
    expect(forgetPaths(m, ["C:\\b.txt"])).toBe(m);
  });
});

describe("persistência", () => {
  beforeEach(() => localStorage.clear());

  it("grava e lê de volta", () => {
    const m = setTagOn({}, ["C:\\a.txt"], "fiscal", true);
    saveTags(m);
    expect(loadTags()).toEqual(m);
  });

  it("valor corrompido não derruba o app — começa do zero", () => {
    localStorage.setItem("localfiles.tags", "{isso nao e json");
    expect(loadTags()).toEqual({});
    localStorage.setItem("localfiles.tags", '["array em vez de objeto"]');
    expect(loadTags()).toEqual({});
    // Forma quase certa mas com lixo dentro: entra só o que é etiqueta.
    localStorage.setItem(
      "localfiles.tags",
      JSON.stringify({ "c:\\a.txt": ["ok", 42, "", null, "ok"], "c:\\b.txt": "nao e lista" }),
    );
    expect(loadTags()).toEqual({ "c:\\a.txt": ["ok"] });
  });
});
