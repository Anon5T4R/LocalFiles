mod ops;
mod search;
mod thumbs;
mod watch;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use ops::{Mode, OpsState};
use watch::WatchState;

// ---------- listagem ----------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Entry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    modified_ms: i64,
    ext: String,
    hidden: bool,
    readonly: bool,
    is_symlink: bool,
}

/// Monta um Entry a partir de caminho+metadata (listagem e busca usam o mesmo).
pub(crate) fn entry_from(path: &Path, meta: &fs::Metadata, name: String) -> Entry {
    let is_dir = meta.is_dir();
    let ext = if is_dir {
        String::new()
    } else {
        path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
    };
    let hidden = is_hidden(meta, &name);
    Entry {
        name,
        path: path.to_string_lossy().into_owned(),
        is_dir,
        size: if is_dir { 0 } else { meta.len() },
        modified_ms: modified_ms(meta),
        ext,
        hidden,
        readonly: meta.permissions().readonly(),
        is_symlink: meta.file_type().is_symlink(),
    }
}

fn modified_ms(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(windows)]
pub(crate) fn is_hidden(meta: &fs::Metadata, _name: &str) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
    meta.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0
}

#[cfg(not(windows))]
pub(crate) fn is_hidden(_meta: &fs::Metadata, name: &str) -> bool {
    name.starts_with('.')
}

/// Lista um diretório (uma entrada por item; itens ilegíveis são pulados,
/// nunca derrubam a listagem inteira). Ordenação fica no front.
#[tauri::command(async)]
fn list_dir(path: String, show_hidden: bool) -> Result<Vec<Entry>, String> {
    let dir = Path::new(&path);
    let rd = fs::read_dir(dir).map_err(|e| format!("{}: {}", path, e))?;
    let mut out = Vec::new();
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        // symlink_metadata: não segue o link (evita travar em link quebrado).
        let Ok(smeta) = entry.metadata().or_else(|_| fs::symlink_metadata(entry.path())) else {
            continue;
        };
        if is_hidden(&smeta, &name) && !show_hidden {
            continue;
        }
        out.push(entry_from(&entry.path(), &smeta, name));
    }
    Ok(out)
}

// ---------- discos e pastas conhecidas ----------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Drive {
    name: String,
    mount: String,
    total: u64,
    available: u64,
    removable: bool,
}

#[tauri::command(async)]
fn list_drives() -> Vec<Drive> {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let mut out: Vec<Drive> = disks
        .iter()
        .map(|d| Drive {
            name: d.name().to_string_lossy().into_owned(),
            mount: d.mount_point().to_string_lossy().into_owned(),
            total: d.total_space(),
            available: d.available_space(),
            removable: d.is_removable(),
        })
        .collect();
    out.sort_by(|a, b| a.mount.cmp(&b.mount));
    out.dedup_by(|a, b| a.mount == b.mount);
    out
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct KnownFolder {
    id: String,
    path: String,
}

/// Pastas conhecidas da sidebar (só as que existem nesta máquina).
#[tauri::command(async)]
fn known_folders(app: AppHandle) -> Vec<KnownFolder> {
    let p = app.path();
    let candidates: Vec<(&str, Option<PathBuf>)> = vec![
        ("home", p.home_dir().ok()),
        ("desktop", p.desktop_dir().ok()),
        ("documents", p.document_dir().ok()),
        ("downloads", p.download_dir().ok()),
        ("pictures", p.picture_dir().ok()),
        ("music", p.audio_dir().ok()),
        ("videos", p.video_dir().ok()),
    ];
    candidates
        .into_iter()
        .filter_map(|(id, path)| {
            let path = path?;
            path.is_dir().then(|| KnownFolder {
                id: id.into(),
                path: path.to_string_lossy().into_owned(),
            })
        })
        .collect()
}

// ---------- operações ----------

/// Valida um nome de arquivo/pasta (sem separador nem reservados do Windows).
fn validate_name(name: &str) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err("nome inválido".into());
    }
    let bad = ['/', '\\', '<', '>', ':', '"', '|', '?', '*'];
    if trimmed.chars().any(|c| bad.contains(&c) || (c as u32) < 0x20) {
        return Err("o nome contém caracteres inválidos".into());
    }
    // Espaços nas pontas são aparados pelos comandos (create/rename usam
    // `name.trim()`); ponto final não é aparável e o Windows rejeita.
    if trimmed.ends_with('.') {
        return Err("o nome não pode terminar em ponto".into());
    }
    Ok(())
}

#[tauri::command(async)]
fn create_folder(parent: String, name: String) -> Result<String, String> {
    validate_name(&name)?;
    let target = ops::unique_target(&Path::new(&parent).join(name.trim()));
    fs::create_dir(&target).map_err(|e| format!("{}: {}", target.display(), e))?;
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command(async)]
fn create_file(parent: String, name: String) -> Result<String, String> {
    validate_name(&name)?;
    let target = ops::unique_target(&Path::new(&parent).join(name.trim()));
    // create_new: nunca sobrescreve (unique_target já evita colisão, mas garante).
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
        .map_err(|e| format!("{}: {}", target.display(), e))?;
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command(async)]
fn rename_entry(path: String, new_name: String) -> Result<String, String> {
    validate_name(&new_name)?;
    let src = PathBuf::from(&path);
    let parent = src.parent().ok_or("sem pasta pai")?;
    let dest = parent.join(new_name.trim());
    if dest == src {
        return Ok(path);
    }
    // Case-only rename (Windows trata "a.txt" == "A.TXT"): deixa passar.
    let case_only = dest.to_string_lossy().to_lowercase() == src.to_string_lossy().to_lowercase();
    if dest.exists() && !case_only {
        return Err("já existe um item com esse nome".into());
    }
    fs::rename(&src, &dest).map_err(|e| format!("{}: {}", src.display(), e))?;
    Ok(dest.to_string_lossy().into_owned())
}

/// Excluir = lixeira do SO, sempre (regra da suíte; delete permanente nem existe aqui).
#[tauri::command(async)]
fn delete_to_trash(paths: Vec<String>) -> Result<(), String> {
    trash::delete_all(&paths).map_err(|e| e.to_string())
}

/// Dispara cópia/movimentação em background; devolve o op_id na hora.
/// Progresso/término chegam pelos eventos `fileop-progress`/`fileop-done`.
#[tauri::command(async)]
fn start_transfer(
    app: AppHandle,
    state: State<'_, OpsState>,
    sources: Vec<String>,
    dest_dir: String,
    is_move: bool,
) -> Result<u64, String> {
    if sources.is_empty() {
        return Err("nada pra transferir".into());
    }
    let (op_id, cancel) = state.register();
    let sources: Vec<PathBuf> = sources.into_iter().map(PathBuf::from).collect();
    let dest = PathBuf::from(dest_dir);
    let handle = app.clone();
    std::thread::spawn(move || {
        let mode = if is_move { Mode::Move } else { Mode::Copy };
        ops::run_transfer(&handle, op_id, cancel, sources, dest, mode);
        handle.state::<OpsState>().finish(op_id);
    });
    Ok(op_id)
}

/// Cancela qualquer operação registrada (transferência OU busca).
#[tauri::command(async)]
fn cancel_op(state: State<'_, OpsState>, op_id: u64) {
    state.cancel(op_id);
}

// ---------- busca / watcher / lote (v0.2) ----------

/// Dispara a busca recursiva; resultados via `search-result`/`search-done`.
#[tauri::command(async)]
fn start_search(
    app: AppHandle,
    state: State<'_, OpsState>,
    root: String,
    query: String,
    in_content: bool,
    show_hidden: bool,
) -> Result<u64, String> {
    if query.trim().is_empty() {
        return Err("busca vazia".into());
    }
    let (op_id, cancel) = state.register();
    let handle = app.clone();
    std::thread::spawn(move || {
        search::run_search(handle.clone(), op_id, cancel, root, query, in_content, show_hidden);
        handle.state::<OpsState>().finish(op_id);
    });
    Ok(op_id)
}

/// Observa a pasta da aba ativa (`dir-changed` debounced quando muda por fora).
#[tauri::command(async)]
fn watch_dir(app: AppHandle, state: State<'_, WatchState>, path: String) -> Result<(), String> {
    watch::watch_dir(&app, &state, path)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameSpec {
    path: String,
    new_name: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RenameResult {
    ok: bool,
    new_path: Option<String>,
    error: Option<String>,
}

/// Renomear em lote: aplica item a item (a UI pré-validou colisões) e devolve
/// o resultado de cada um — um erro não interrompe os demais.
#[tauri::command(async)]
fn batch_rename(items: Vec<RenameSpec>) -> Vec<RenameResult> {
    items
        .into_iter()
        .map(|it| match rename_entry(it.path, it.new_name) {
            Ok(p) => RenameResult { ok: true, new_path: Some(p), error: None },
            Err(e) => RenameResult { ok: false, new_path: None, error: Some(e) },
        })
        .collect()
}

// ---------- propriedades ----------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Properties {
    path: String,
    is_dir: bool,
    size: u64,
    files: u64,
    folders: u64,
    modified_ms: i64,
    readonly: bool,
    hidden: bool,
    /// true se a varredura parou no teto (pasta gigante — números parciais).
    truncated: bool,
}

const PROPS_MAX_ENTRIES: u64 = 500_000;

fn dir_stats(path: &Path, size: &mut u64, files: &mut u64, folders: &mut u64, seen: &mut u64) -> bool {
    let Ok(rd) = fs::read_dir(path) else { return false };
    for entry in rd.flatten() {
        *seen += 1;
        if *seen > PROPS_MAX_ENTRIES {
            return true;
        }
        let Ok(meta) = entry.metadata().or_else(|_| fs::symlink_metadata(entry.path())) else {
            continue;
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() {
            *folders += 1;
            if dir_stats(&entry.path(), size, files, folders, seen) {
                return true;
            }
        } else {
            *files += 1;
            *size += meta.len();
        }
    }
    false
}

#[tauri::command(async)]
fn entry_properties(path: String) -> Result<Properties, String> {
    let p = Path::new(&path);
    let meta = fs::symlink_metadata(p).map_err(|e| format!("{}: {}", path, e))?;
    let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let mut props = Properties {
        path: path.clone(),
        is_dir: meta.is_dir(),
        size: if meta.is_dir() { 0 } else { meta.len() },
        files: 0,
        folders: 0,
        modified_ms: modified_ms(&meta),
        readonly: meta.permissions().readonly(),
        hidden: is_hidden(&meta, &name),
        truncated: false,
    };
    if meta.is_dir() {
        let mut seen = 0u64;
        props.truncated =
            dir_stats(p, &mut props.size, &mut props.files, &mut props.folders, &mut seen);
    }
    Ok(props)
}

// ---------- integração com o SO ----------

/// "Abrir com…" nativo do Windows (no Linux o front usa o opener direto).
#[tauri::command(async)]
fn open_with_dialog(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        std::process::Command::new("rundll32.exe")
            .args(["shell32.dll,OpenAs_RunDLL", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("indisponível nesta plataforma".into())
    }
}

/// Pasta passada no launch (abrir o LocalFiles já num diretório), se houver.
#[tauri::command(async)]
fn get_startup_dir() -> Option<String> {
    startup_dir_from(std::env::args().skip(1))
}

fn startup_dir_from(args: impl Iterator<Item = String>) -> Option<String> {
    args.filter(|a| !a.starts_with('-'))
        .find(|a| Path::new(a).is_dir())
}

// ---------- bootstrap ----------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        // Segunda instância: foca a janela e, se veio um diretório, navega nele.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_focus();
            }
            if let Some(dir) = startup_dir_from(args.into_iter().skip(1)) {
                let _ = app.emit("open-dir", dir);
            }
        }));
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(OpsState::default())
        .manage(WatchState::default())
        .invoke_handler(tauri::generate_handler![
            list_dir,
            list_drives,
            known_folders,
            create_folder,
            create_file,
            rename_entry,
            delete_to_trash,
            start_transfer,
            cancel_op,
            entry_properties,
            open_with_dialog,
            get_startup_dir,
            start_search,
            watch_dir,
            batch_rename,
            thumbs::thumbnail,
            thumbs::read_text_head,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_name_regras() {
        assert!(validate_name("relatório final.pdf").is_ok());
        assert!(validate_name("").is_err());
        assert!(validate_name("  ").is_err());
        assert!(validate_name("a/b").is_err());
        assert!(validate_name("a\\b").is_err());
        assert!(validate_name("con?").is_err());
        assert!(validate_name("termina.").is_err());
        // Espaço nas pontas é aparado (não é erro): "termina " vira "termina".
        assert!(validate_name("termina ").is_ok());
    }

    #[test]
    fn startup_dir_ignora_flags_e_arquivos() {
        let tmp = std::env::temp_dir().to_string_lossy().into_owned();
        let args = vec!["--flag".to_string(), tmp.clone()];
        assert_eq!(startup_dir_from(args.into_iter()), Some(tmp));
        assert_eq!(startup_dir_from(vec!["--x".to_string()].into_iter()), None);
    }
}
