import { useEffect, useRef, useState } from "react";
import * as actions from "../lib/actions";
import BatchRenameModal from "./BatchRenameModal";
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
        {dialog.kind === "newFolder" && <NewEntryDialog file={false} />}
        {dialog.kind === "newFile" && <NewEntryDialog file={true} />}
        {dialog.kind === "delete" && (
          <DeleteDialog paths={dialog.paths} firstName={dialog.firstName} />
        )}
        {dialog.kind === "properties" && <PropertiesDialog />}
        {dialog.kind === "batchRename" && <BatchRenameModal paths={dialog.paths} />}
        {dialog.kind === "tags" && <TagsDialog paths={dialog.paths} />}
      </div>
    </div>
  );
}

function NewEntryDialog({ file }: { file: boolean }) {
  const setDialog = useUi((s) => s.setDialog);
  const entries = useFiles((s) => s.activeTab().entries);
  const existing = new Set(entries.map((e) => e.name.toLowerCase()));
  const defaultName = file ? t("dlg.defaultFileName") : t("dlg.defaultFolderName");
  const [name, setName] = useState(() => uniqueName(defaultName, existing));
  const ref = useRef<HTMLInputElement>(null);
  const confirm = () => {
    if (!name.trim()) return;
    if (file) void actions.confirmNewFile(name);
    else void actions.confirmNewFolder(name);
  };

  useEffect(() => {
    ref.current?.focus();
    // Seleciona só o nome-base (sem a extensão) pra digitar por cima.
    const dot = file ? name.lastIndexOf(".") : -1;
    if (dot > 0) ref.current?.setSelectionRange(0, dot);
    else ref.current?.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <h2>{file ? t("dlg.newFileTitle") : t("dlg.newFolderTitle")}</h2>
      <label className="field">
        <span>{file ? t("dlg.newFileName") : t("dlg.newFolderName")}</span>
        <input
          ref={ref}
          value={name}
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") confirm();
          }}
        />
      </label>
      <div className="modal-actions">
        <button onClick={() => setDialog(null)}>{t("dlg.cancel")}</button>
        <button className="primary" disabled={!name.trim()} onClick={confirm}>
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

/**
 * Etiquetas da seleção.
 *
 * Com VÁRIOS itens selecionados uma etiqueta pode estar em alguns e não em
 * outros — o estado do meio existe e é mostrado (indeterminado), em vez de
 * fingir que é "não" e apagar a etiqueta de quem já a tinha no primeiro clique.
 */
function TagsDialog({ paths }: { paths: string[] }) {
  const setDialog = useUi((s) => s.setDialog);
  const tags = useFiles((s) => s.tags);
  const { applyTag, knownTags, tagsFor } = useFiles.getState();
  const [novo, setNovo] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const porItem = paths.map((p) => tagsFor(p));
  const conhecidas = knownTags().map((x) => x.tag);
  // Etiquetas que aparecem em pelo menos um dos selecionados + todas as já usadas.
  const universo = [...new Set([...conhecidas, ...porItem.flat()])];

  const estado = (tag: string): "todos" | "alguns" | "nenhum" => {
    const n = porItem.filter((list) => list.includes(tag)).length;
    return n === 0 ? "nenhum" : n === paths.length ? "todos" : "alguns";
  };

  const criar = () => {
    const t2 = novo.trim();
    if (!t2) return;
    applyTag(paths, t2, true);
    setNovo("");
  };

  return (
    <>
      <h2>{t("tag.title")}</h2>
      <p className="muted">
        {paths.length === 1 ? t("tag.forOne") : t("tag.forMany", { n: paths.length })}
      </p>

      <div className="tag-list">
        {universo.length === 0 && <p className="muted">{t("tag.none")}</p>}
        {universo.map((tg) => {
          const st = estado(tg);
          return (
            <label key={tg} className={`tag-row ${st}`}>
              <input
                type="checkbox"
                checked={st === "todos"}
                ref={(el) => {
                  if (el) el.indeterminate = st === "alguns";
                }}
                onChange={() => applyTag(paths, tg, st !== "todos")}
              />
              <span className="tag-chip">{tg}</span>
              {st === "alguns" && <span className="muted">{t("tag.partial")}</span>}
            </label>
          );
        })}
      </div>

      <label className="field">
        <span>{t("tag.new")}</span>
        <input
          ref={ref}
          value={novo}
          maxLength={24}
          spellCheck={false}
          onChange={(e) => setNovo(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") criar();
          }}
        />
      </label>

      <div className="modal-actions">
        <button disabled={!novo.trim()} onClick={criar}>
          {t("tag.add")}
        </button>
        <button className="primary" onClick={() => setDialog(null)}>
          {t("dlg.confirm")}
        </button>
      </div>
      {/* `tags` na dependência do render: mudar etiqueta redesenha a lista. */}
      <span hidden>{Object.keys(tags).length}</span>
    </>
  );
}
