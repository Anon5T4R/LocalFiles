import { useState } from "react";
import * as backend from "../lib/backend";
import type { Entry } from "../lib/types";
import { useFiles } from "../state/tabs";
import { useUi } from "../state/ui";

interface Props {
  path: string;
  icon: string;
  /** Rótulo do nó raiz (texto simples ou markup, ex.: barra de uso da unidade). */
  label: React.ReactNode;
  depth: number;
}

/**
 * Nó de árvore expansível na sidebar: clicar no rótulo navega, clicar no
 * chevron expande/recolhe carregando as subpastas sob demanda (`list_dir`).
 * Aceita soltar itens arrastados (mover; Ctrl = copiar), igual aos outros
 * destinos da sidebar.
 */
export default function FolderTree({ path, icon, label, depth }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<Entry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const current = useFiles(
    (s) => s.activeTab().path,
  );
  const navigate = useFiles((s) => s.navigate);

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (!expanded && children === null) {
      setLoading(true);
      try {
        const list = await backend.listDir(path, useUi.getState().showHidden);
        setChildren(list.filter((x) => x.isDir && !x.isSymlink));
      } catch {
        setChildren([]);
      }
      setLoading(false);
    }
    setExpanded((v) => !v);
  }

  return (
    <>
      <div
        className={`side-item tree ${current === path ? "active" : ""}`}
        style={{ paddingLeft: 4 + depth * 14 }}
        title={typeof path === "string" ? path : undefined}
        onClick={() => void navigate(path)}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("application/x-localfiles")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = e.ctrlKey ? "copy" : "move";
          }
        }}
        onDrop={(e) => {
          const raw = e.dataTransfer.getData("application/x-localfiles");
          if (!raw) return;
          e.preventDefault();
          void useFiles.getState().startOp(JSON.parse(raw) as string[], path, !e.ctrlKey);
        }}
      >
        <span
          className={`tree-toggle ${loading ? "loading" : ""}`}
          onClick={toggle}
          role="button"
          aria-label={expanded ? "recolher" : "expandir"}
        >
          {loading ? "·" : expanded ? "▾" : "▸"}
        </span>
        <span className="side-icon">{icon}</span>
        <span className="side-name">{label}</span>
      </div>
      {expanded &&
        children?.map((c) => (
          <FolderTree key={c.path} path={c.path} icon="📁" label={c.name} depth={depth + 1} />
        ))}
    </>
  );
}
