import { describe, expect, it } from "vitest";
import { batchPreview, isValidName, type BatchOptions } from "../rename";

const base: BatchOptions = {
  mode: "replace",
  find: "",
  replace: "",
  regex: false,
  pattern: "{nome}",
  start: 1,
};

describe("batchPreview — localizar/substituir", () => {
  it("substitui texto simples no nome, preservando a extensão", () => {
    const out = batchPreview(
      [
        { name: "IMG_001.jpg", isDir: false },
        { name: "IMG_002.jpg", isDir: false },
      ],
      { ...base, find: "IMG", replace: "Praia" },
    );
    expect(out.map((p) => p.newName)).toEqual(["Praia_001.jpg", "Praia_002.jpg"]);
    expect(out.every((p) => p.changed && !p.conflict)).toBe(true);
  });

  it("escapa caracteres especiais quando regex está desligado", () => {
    const out = batchPreview([{ name: "a(1).txt", isDir: false }], {
      ...base,
      find: "(1)",
      replace: "",
    });
    expect(out[0].newName).toBe("a.txt");
  });

  it("regex ligado usa o padrão de verdade", () => {
    const out = batchPreview([{ name: "foto123.png", isDir: false }], {
      ...base,
      find: "\\d+",
      replace: "#",
      regex: true,
    });
    expect(out[0].newName).toBe("foto#.png");
  });

  it("regex inválida enquanto digita não muda nada", () => {
    const out = batchPreview([{ name: "a.txt", isDir: false }], {
      ...base,
      find: "[",
      regex: true,
    });
    expect(out[0].newName).toBe("a.txt");
    expect(out[0].changed).toBe(false);
  });

  it("pasta não tem extensão separada", () => {
    const out = batchPreview([{ name: "v1.0", isDir: true }], {
      ...base,
      find: "1.0",
      replace: "2.0",
    });
    expect(out[0].newName).toBe("v2.0");
  });
});

describe("batchPreview — padrão com contador", () => {
  it("numera na ordem, preservando extensões", () => {
    const out = batchPreview(
      [
        { name: "a.jpg", isDir: false },
        { name: "b.png", isDir: false },
      ],
      { ...base, mode: "pattern", pattern: "Férias {n}", start: 7 },
    );
    expect(out.map((p) => p.newName)).toEqual(["Férias 7.jpg", "Férias 8.png"]);
  });

  it("{nome} entra no template", () => {
    const out = batchPreview([{ name: "relatorio.pdf", isDir: false }], {
      ...base,
      mode: "pattern",
      pattern: "{n} - {nome}",
      start: 1,
    });
    expect(out[0].newName).toBe("1 - relatorio.pdf");
  });

  it("padrão sem {n} gera colisão entre os itens", () => {
    const out = batchPreview(
      [
        { name: "a.txt", isDir: false },
        { name: "b.txt", isDir: false },
      ],
      { ...base, mode: "pattern", pattern: "igual" },
    );
    expect(out.every((p) => p.conflict)).toBe(true);
  });
});

describe("isValidName", () => {
  it("rejeita separadores, reservados e ponto final", () => {
    expect(isValidName("ok.txt")).toBe(true);
    expect(isValidName("a/b")).toBe(false);
    expect(isValidName("a\\b")).toBe(false);
    expect(isValidName("con?")).toBe(false);
    expect(isValidName("fim.")).toBe(false);
    expect(isValidName("")).toBe(false);
  });
});
