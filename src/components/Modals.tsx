import { useEffect, useRef, useState } from "react";
import * as actions from "../lib/actions";
import { formatBytes, formatDate, kindOf, uniqueName } from "../lib/fsutil";
import { localeTag, t } from "../lib/i18n";
import { useFiles } from "../state/tabs";
import { useUi } from "../state/ui";

/** Diálogos modais: nova pasta, confirmação de exclusão e propriedades. */
export default function Modals() {
  const dialog = useUi((s) => s.dialog);
  const setDialog = useUi((s) => s.setDialog);

  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDialog(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, setDialog]);

  if (!dialog) return null;

  return (
    <div className="modal-backdrop" onClick={() => setDialog(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {dialog.kind === "newFolder" && <NewFolderDialog />}
        {dialog.kind === "delete" && (
          <DeleteDialog paths={dialog.paths} firstName={dialog.firstName} />
        )}
        {dialog.kind === "properties" && <PropertiesDialog />}
      </div>
    </div>
  );
}

function NewFolderDialog() {
  const setDialog = useUi((s) => s.setDialog);
  const entries = useFiles((s) => (s.tabs.find((tb) => tb.id === s.activeTabId) ?? s.tabs[0]).entries);
  const existing = new Set(entries.map((e) => e.name.toLowerCase()));
  const [name, setName] = useState(() => uniqueName(t("dlg.defaultFolderName"), existing));
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <>
      <h2>{t("dlg.newFolderTitle")}</h2>
      <label className="field">
        <span>{t("dlg.newFolderName")}</span>
        <input
          ref={ref}
          value={name}
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) void actions.confirmNewFolder(name);
          }}
        />
      </label>
      <div className="modal-actions">
        <button onClick={() => setDialog(null)}>{t("dlg.cancel")}</button>
        <button
          className="primary"
          disabled={!name.trim()}
          onClick={() => void actions.confirmNewFolder(name)}
        >
          {t("dlg.create")}
        </button>
      </div>
    </>
  );
}

function DeleteDialog({ paths, firstName }: { paths: string[]; firstName: string }) {
  const setDialog = useUi((s) => s.setDialog);
  return (
    <>
      <h2>{t("dlg.deleteTitle")}</h2>
      <p>
        {paths.length === 1
          ? t("dlg.deleteOne", { name: firstName })
          : t("dlg.deleteMany", { n: paths.length })}
      </p>
      <p className="muted">{t("dlg.deleteNote")}</p>
      <div className="modal-actions">
        <button onClick={() => setDialog(null)}>{t("dlg.cancel")}</button>
        <button className="danger" onClick={() => void actions.confirmDelete(paths)}>
          {t("dlg.deleteAction")}
        </button>
      </div>
    </>
  );
}

function PropertiesDialog() {
  const dialog = useUi((s) => s.dialog);
  if (dialog?.kind !== "properties") return null;
  const { path, props } = dialog;
  const name = path.split(/[\\/]/).pop() || path;
  const parent = path.slice(0, path.length - name.length).replace(/[\\/]$/, "");

  const row = (label: string, value: React.ReactNode) => (
    <div className="prop-row">
      <span className="prop-label">{label}</span>
      <span className="prop-value">{value}</span>
    </div>
  );

  const attrs = props
    ? [props.readonly ? t("props.readonly") : null, props.hidden ? t("props.hidden") : null]
        .filter(Boolean)
        .join(", ") || t("props.none")
    : "";

  return (
    <>
      <h2>{t("props.title")}</h2>
      <div className="prop-name">{name}</div>
      {row(t("props.location"), parent)}
      {props ? (
        <>
          {row(
            t("props.type"),
            props.isDir
              ? t("kind.folder")
              : t(`kind.${kindOf({ isDir: false, ext: name.includes(".") ? name.split(".").pop()!.toLowerCase() : "" })}` as Parameters<typeof t>[0]),
          )}
          {row(
            t("props.size"),
            `${formatBytes(props.size)}${props.truncated ? ` ${t("props.truncated")}` : ""}`,
          )}
          {props.isDir &&
            row(
              t("props.contains"),
              `${t("props.contents", { files: props.files, folders: props.folders })}${props.truncated ? ` ${t("props.truncated")}` : ""}`,
            )}
          {row(t("props.modified"), formatDate(props.modifiedMs, localeTag()))}
          {row(t("props.attributes"), attrs)}
        </>
      ) : (
        <p className="muted">{t("props.calculating")}</p>
      )}
      <div className="modal-actions">
        <button className="primary" onClick={() => useUi.getState().setDialog(null)}>
          {t("dlg.confirm")}
        </button>
      </div>
    </>
  );
}
