import { describe, expect, it } from "vitest";
import { terminalErrorKind, terminalTarget } from "../terminal";
import { joinVirtual } from "../apath";

describe("terminalTarget", () => {
  it("pasta comum vira alvo", () => {
    expect(terminalTarget("C:\\proj")).toEqual({ ok: true, dir: "C:\\proj" });
    expect(terminalTarget("/home/j/proj")).toEqual({ ok: true, dir: "/home/j/proj" });
  });

  it("apara o espaço em volta", () => {
    expect(terminalTarget("  C:\\proj  ")).toEqual({ ok: true, dir: "C:\\proj" });
  });

  it("caminho vazio/nulo não abre nada", () => {
    for (const v of ["", "   ", null, undefined]) {
      expect(terminalTarget(v)).toEqual({ ok: false, reason: "empty" });
    }
  });

  it("dentro de um compactado é recusado — não há caminho de disco", () => {
    // Usa o MESMO construtor de caminho virtual da produção; escrever o "::"
    // à mão faria o teste passar mesmo se a convenção mudasse.
    const dentro = joinVirtual("C:\\x\\a.zip", "docs");
    expect(terminalTarget(dentro)).toEqual({ ok: false, reason: "inArchive" });
    expect(terminalTarget(joinVirtual("C:\\x\\a.zip", ""))).toEqual({
      ok: false,
      reason: "inArchive",
    });
  });

  it("uma pasta chamada como um zip, mas real, PASSA", () => {
    // Guarda contra confundir "termina em .zip" com "está dentro de um zip".
    expect(terminalTarget("C:\\x\\a.zip")).toEqual({ ok: true, dir: "C:\\x\\a.zip" });
  });
});

describe("terminalErrorKind", () => {
  it("a sentinela do Rust vira 'não instalado'", () => {
    expect(terminalErrorKind("TERMINAL_NOT_INSTALLED")).toBe("notInstalled");
    expect(terminalErrorKind(new Error("TERMINAL_NOT_INSTALLED"))).toBe("notInstalled");
  });

  it("qualquer outro erro é falha de verdade", () => {
    expect(terminalErrorKind("A pasta não existe mais: C:\\x")).toBe("failed");
    expect(terminalErrorKind("Falha ao abrir o LocalTerminal: acesso negado")).toBe("failed");
    expect(terminalErrorKind(null)).toBe("failed");
  });
});
