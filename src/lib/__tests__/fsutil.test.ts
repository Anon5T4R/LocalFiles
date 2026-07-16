import { describe, expect, it } from "vitest";
import {
  breadcrumbOf,
  formatBytes,
  joinPath,
  kindOf,
  normalizePath,
  parentOf,
  sortEntries,
  uniqueName,
} from "../fsutil";
import type { Entry } from "../types";

function entry(partial: Partial<Entry>): Entry {
  return {
    name: "a",
    path: "C:\\a",
    isDir: false,
    size: 0,
    modifiedMs: 0,
    ext: "",
    hidden: false,
    readonly: false,
    isSymlink: false,
    ...partial,
  };
}

describe("normalizePath / parentOf", () => {
  it("normaliza barras e tira barra final", () => {
    expect(normalizePath("C:/Users/João/")).toBe("C:\\Users\\João");
    expect(normalizePath("C:\\")).toBe("C:\\");
    expect(normalizePath("C:")).toBe("C:\\");
    expect(normalizePath("/home/user/")).toBe("/home/user");
  });

  it("pai no Windows", () => {
    expect(parentOf("C:\\Users\\João")).toBe("C:\\Users");
    expect(parentOf("C:\\Users")).toBe("C:\\");
    expect(parentOf("C:\\")).toBeNull();
  });

  it("pai no Unix", () => {
    expect(parentOf("/home/user")).toBe("/home");
    expect(parentOf("/home")).toBe("/");
    expect(parentOf("/")).toBeNull();
  });
});

describe("breadcrumbOf", () => {
  it("segmentos Windows com caminhos acumulados", () => {
    expect(breadcrumbOf("C:\\Users\\João")).toEqual([
      { name: "C:", path: "C:\\" },
      { name: "Users", path: "C:\\Users" },
      { name: "João", path: "C:\\Users\\João" },
    ]);
  });

  it("segmentos Unix começam na raiz", () => {
    expect(breadcrumbOf("/home/user")).toEqual([
      { name: "/", path: "/" },
      { name: "home", path: "/home" },
      { name: "user", path: "/home/user" },
    ]);
  });
});

describe("joinPath", () => {
  it("usa o separador do caminho", () => {
    expect(joinPath("C:\\Users", "João")).toBe("C:\\Users\\João");
    expect(joinPath("C:\\", "Users")).toBe("C:\\Users");
    expect(joinPath("/home", "user")).toBe("/home/user");
  });
});

describe("formatBytes", () => {
  it("unidades binárias, 1 casa", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
    expect(formatBytes(-1)).toBe("—");
  });
});

describe("sortEntries", () => {
  const dirB = entry({ name: "beta", isDir: true });
  const dirA = entry({ name: "alfa", isDir: true });
  const f10 = entry({ name: "arquivo10.txt", ext: "txt", size: 5 });
  const f2 = entry({ name: "arquivo2.txt", ext: "txt", size: 100 });
  const fZip = entry({ name: "backup.zip", ext: "zip", size: 50 });

  it("pastas sempre antes; nome com ordenação numérica", () => {
    const out = sortEntries([f10, dirB, f2, dirA], "name", "asc");
    expect(out.map((e) => e.name)).toEqual(["alfa", "beta", "arquivo2.txt", "arquivo10.txt"]);
  });

  it("desc inverte só dentro do grupo", () => {
    const out = sortEntries([f10, dirB, f2, dirA], "name", "desc");
    expect(out.map((e) => e.name)).toEqual(["beta", "alfa", "arquivo10.txt", "arquivo2.txt"]);
  });

  it("por tamanho e por tipo", () => {
    expect(sortEntries([f2, f10, fZip], "size", "asc").map((e) => e.name)).toEqual([
      "arquivo10.txt",
      "backup.zip",
      "arquivo2.txt",
    ]);
    expect(sortEntries([fZip, f10], "type", "asc").map((e) => e.ext)).toEqual(["txt", "zip"]);
  });
});

describe("kindOf", () => {
  it("classifica por extensão", () => {
    expect(kindOf({ isDir: true, ext: "" })).toBe("folder");
    expect(kindOf({ isDir: false, ext: "png" })).toBe("image");
    expect(kindOf({ isDir: false, ext: "mp4" })).toBe("video");
    expect(kindOf({ isDir: false, ext: "zip" })).toBe("archive");
    expect(kindOf({ isDir: false, ext: "xyzabc" })).toBe("file");
  });
});

describe("uniqueName", () => {
  it("sufixa mantendo a extensão", () => {
    const existing = new Set(["a.txt", "a (2).txt"]);
    expect(uniqueName("a.txt", existing)).toBe("a (3).txt");
    expect(uniqueName("b.txt", existing)).toBe("b.txt");
  });

  it("pasta sem extensão", () => {
    const existing = new Set(["nova pasta"]);
    expect(uniqueName("Nova pasta", existing)).toBe("Nova pasta (2)");
  });
});
