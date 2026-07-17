import { create } from "zustand";
import type { Properties } from "../lib/types";

export type Theme = "light" | "dark" | "system";

export interface Toast {
  id: number;
  kind: "info" | "error" | "ok";
  text: string;
}

/** Diálogo modal ativo (um por vez). */
export type Dialog =
  | { kind: "newFolder" }
  | { kind: "newFile" }
  | { kind: "rename"; path: string; name: string }
  | { kind: "delete"; paths: string[]; firstName: string }
  | { kind: "properties"; path: string; props: Properties | null }
  | { kind: "batchRename"; paths: string[] }
  | null;

export interface MenuState {
  x: number;
  y: number;
  /** Entrada clicada (null = área vazia da pasta). */
  targetPath: string | null;
}

interface UiState {
  theme: Theme;
  settingsOpen: boolean;
  showHidden: boolean;
  previewOpen: boolean;
  dialog: Dialog;
  menu: MenuState | null;
  toasts: Toast[];

  setTheme: (t: Theme) => void;
  setSettingsOpen: (v: boolean) => void;
  setShowHidden: (v: boolean) => void;
  setPreviewOpen: (v: boolean) => void;
  setDialog: (d: Dialog) => void;
  setMenu: (m: MenuState | null) => void;
  pushToast: (kind: Toast["kind"], text: string) => void;
  dismissToast: (id: number) => void;
}

const THEME_KEY = "localfiles.theme";
const HIDDEN_KEY = "localfiles.showHidden";
const PREVIEW_KEY = "localfiles.preview";

function loadTheme(): Theme {
  const v = localStorage.getItem(THEME_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

/** Aplica o tema no <html data-theme> (resolvendo "system" pela mídia). */
export function applyTheme(theme: Theme) {
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  document.documentElement.dataset.theme = resolved;
}

let nextToast = 1;

export const useUi = create<UiState>((set) => ({
  theme: loadTheme(),
  settingsOpen: false,
  showHidden: localStorage.getItem(HIDDEN_KEY) === "1",
  previewOpen: localStorage.getItem(PREVIEW_KEY) === "1",
  dialog: null,
  menu: null,
  toasts: [],

  setTheme: (theme) => {
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
    set({ theme });
  },
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setShowHidden: (showHidden) => {
    localStorage.setItem(HIDDEN_KEY, showHidden ? "1" : "0");
    set({ showHidden });
  },
  setPreviewOpen: (previewOpen) => {
    localStorage.setItem(PREVIEW_KEY, previewOpen ? "1" : "0");
    set({ previewOpen });
  },
  setDialog: (dialog) => set({ dialog }),
  setMenu: (menu) => set({ menu }),
  pushToast: (kind, text) =>
    set((s) => ({ toasts: [...s.toasts, { id: nextToast++, kind, text }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
