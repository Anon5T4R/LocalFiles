import { useEffect, useState } from "react";
import { readTextHead } from "../lib/backend";
import { KIND_ICON, formatBytes, formatDate, kindOf, type FileKind } from "../lib/fsutil";
import { getThumb } from "../lib/thumbs";
import { localeTag, t } from "../lib/i18n";
import type { Entry } from "../lib/types";
import { useFiles } from "../state/tabs";
import { useUi } from "../state/ui";

/** Tipos que mostramos como texto no preview. */
const TEXTUAL: FileKind[] = ["document", "code"];
const TEXT_HEAD_BYTES = 64 * 1024;

/**
 * Painel lateral de visualização (Alt+P): imagem (miniatura grande), começo
 * de arquivo de texto, ou ícone + infos. Aparece com UM item selecionado.
 */
export default function PreviewPanel() {
  const open = useUi((s) => s.previewOpen);
  const tab = useFiles((s) => s.activeTab());
  const search = useFiles((s) => s.search);

  if (!open) return null;

  const entries = search ? search.results : tab.entries;
  const entry =
    tab.selection.length === 1 ? entries.find((e) => e.path === tab.selection[0]) : undefined;

  return (
    <aside className="preview-panel">
      {entry ? <PreviewBody entry={entry} /> : (
        <div className="preview-empty">{t("preview.select")}</div>
      )}
    </aside>
  );
}

function PreviewBody({ entry }: { entry: Entry }) {
  const kind = kindOf(entry);
  const [img, setImg] = useState<string | null>(null);
  const [text, setText] = useState<{ text: string; truncated: boolean } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setImg(null);
    setText(null);
    setFailed(false);
    if (kind === "image") {
      void getThumb(entry.path, 512).then((url) => {
        if (!alive) return;
        if (url) setImg(url);
        else setFailed(true);
      });
    } else if (TEXTUAL.includes(kind) && !entry.isDir) {
      readTextHead(entry.path, TEXT_HEAD_BYTES)
        .then((th) => {
          if (alive) setText(th);
        })
        .catch(() => {
          if (alive) setFailed(true);
        });
    }
    return () => {
      alive = false;
    };
  }, [entry.path, entry.modifiedMs, kind, entry.isDir]);

  const info = (
    <div className="preview-info">
      <div className="prop-row">
        <span className="prop-label">{t("props.type")}</span>
        <span className="prop-value">
          {entry.isDir ? t("kind.folder") : t(`kind.${kind}` as Parameters<typeof t>[0])}
        </span>
      </div>
      {!entry.isDir && (
        <div className="prop-row">
          <span className="prop-label">{t("props.size")}</span>
          <span className="prop-value">{formatBytes(entry.size)}</span>
        </div>
      )}
      <div className="prop-row">
        <span className="prop-label">{t("props.modified")}</span>
        <span className="prop-value">{formatDate(entry.modifiedMs, localeTag())}</span>
      </div>
    </div>
  );

  return (
    <div className="preview-body">
      <div className="preview-name" title={entry.path}>
        {entry.name}
      </div>
      {img ? (
        <img className="preview-img" src={img} alt={entry.name} />
      ) : text ? (
        <>
          <pre className="preview-text">{text.text}</pre>
          {text.truncated && <div className="muted small">{t("preview.truncated")}</div>}
        </>
      ) : (
        <div className="preview-icon-wrap">
          <span className="preview-icon">{KIND_ICON[kind]}</span>
          {failed && <div className="muted small">{t("preview.unavailable")}</div>}
        </div>
      )}
      {info}
    </div>
  );
}
