import { useMemo, useState } from "react";
import { batchRename } from "../lib/backend";
import { batchPreview, type BatchMode, type BatchOptions } from "../lib/rename";
import { t } from "../lib/i18n";
import { useFiles } from "../state/tabs";
import { useUi } from "../state/ui";

/**
 * Renomear em lote: localizar/substituir (regex opcional) OU padrão com
 * contador ({nome}/{n}), com prévia ao vivo e bloqueio de conflitos.
 */
export default function BatchRenameModal({ paths }: { paths: string[] }) {
  const setDialog = useUi((s) => s.setDialog);
  const entries = useFiles.getState().visibleEntries();
  const items = useMemo(
    () =>
      paths
        .map((p) => entries.find((e) => e.path === p))
        .filter(Boolean)
        .map((e) => ({ path: e!.path, name: e!.name, isDir: e!.isDir })),
    [paths, entries],
  );

  const [mode, setMode] = useState<BatchMode>("replace");
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [regex, setRegex] = useState(false);
  const [pattern, setPattern] = useState("{nome}");
  const [start, setStart] = useState(1);
  const [busy, setBusy] = useState(false);

  const opts: BatchOptions = { mode, find, replace, regex, pattern, start };
  const preview = useMemo(() => batchPreview(items, opts), [items, mode, find, replace, regex, pattern, start]); // eslint-disable-line react-hooks/exhaustive-deps

  const conflicts = preview.filter((p) => p.conflict).length;
  const changed = preview.filter((p) => p.changed && !p.conflict).length;
  const canApply = conflicts === 0 && changed > 0 && !busy;

  const apply = async () => {
    setBusy(true);
    const specs = items
      .map((it, i) => ({ path: it.path, newName: preview[i].newName, changed: preview[i].changed }))
      .filter((s) => s.changed)
      .map(({ path, newName }) => ({ path, newName }));
    try {
      const results = await batchRename(specs);
      const failed = results.filter((r) => !r.ok);
      const ui = useUi.getState();
      if (failed.length === 0) {
        ui.pushToast("ok", t("batch.done", { n: results.length }));
      } else {
        ui.pushToast("error", t("batch.someFailed", { n: failed.length, error: failed[0].error ?? "" }));
      }
      setDialog(null);
      await useFiles.getState().refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2>{t("batch.title")}</h2>

      <div className="segmented batch-mode">
        <button className={mode === "replace" ? "active" : ""} onClick={() => setMode("replace")}>
          {t("batch.modeReplace")}
        </button>
        <button className={mode === "pattern" ? "active" : ""} onClick={() => setMode("pattern")}>
          {t("batch.modePattern")}
        </button>
      </div>

      {mode === "replace" ? (
        <div className="batch-fields">
          <label className="field">
            <span>{t("batch.find")}</span>
            <input value={find} onChange={(e) => setFind(e.target.value)} spellCheck={false} />
          </label>
          <label className="field">
            <span>{t("batch.replace")}</span>
            <input value={replace} onChange={(e) => setReplace(e.target.value)} spellCheck={false} />
          </label>
          <label className="check">
            <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} />
            {t("batch.regex")}
          </label>
        </div>
      ) : (
        <div className="batch-fields">
          <label className="field">
            <span>{t("batch.pattern")}</span>
            <input value={pattern} onChange={(e) => setPattern(e.target.value)} spellCheck={false} />
          </label>
          <label className="field small-field">
            <span>{t("batch.start")}</span>
            <input
              type="number"
              value={start}
              onChange={(e) => setStart(Number(e.target.value) || 0)}
            />
          </label>
        </div>
      )}

      <div className="batch-preview-title">{t("batch.preview")}</div>
      <div className="batch-preview">
        {items.map((it, i) => (
          <div key={it.path} className={`batch-row ${preview[i].conflict ? "conflict" : ""}`}>
            <span className="batch-old" title={it.name}>{it.name}</span>
            <span className="batch-arrow">→</span>
            <span className="batch-new" title={preview[i].newName}>
              {preview[i].newName}
              {preview[i].conflict && <em> ({t("batch.conflictBadge")})</em>}
            </span>
          </div>
        ))}
      </div>

      {conflicts > 0 && <p className="batch-warn">{t("batch.conflicts", { n: conflicts })}</p>}
      {conflicts === 0 && changed === 0 && <p className="muted">{t("batch.nothing")}</p>}

      <div className="modal-actions">
        <button onClick={() => setDialog(null)}>{t("dlg.cancel")}</button>
        <button className="primary" disabled={!canApply} onClick={() => void apply()}>
          {t("batch.apply", { n: changed })}
        </button>
      </div>
    </>
  );
}
