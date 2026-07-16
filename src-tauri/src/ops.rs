//! Motor de operações de arquivo (copiar/mover) com progresso e cancelamento.
//!
//! Regras da suíte: nunca sobrescrever silenciosamente (colisão ganha sufixo
//! " (2)"), excluir é sempre pela lixeira (fica no lib.rs, crate `trash`) e a
//! operação roda numa thread própria reportando por eventos Tauri
//! (`fileop-progress` / `fileop-done`).

use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Operações em andamento (op_id → flag de cancelamento).
#[derive(Default)]
pub struct OpsState {
    ops: Mutex<HashMap<u64, Arc<AtomicBool>>>,
    next_id: AtomicU64,
}

impl OpsState {
    pub fn register(&self) -> (u64, Arc<AtomicBool>) {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let flag = Arc::new(AtomicBool::new(false));
        self.ops.lock().unwrap().insert(id, flag.clone());
        (id, flag)
    }

    pub fn cancel(&self, id: u64) {
        if let Some(f) = self.ops.lock().unwrap().get(&id) {
            f.store(true, Ordering::Relaxed);
        }
    }

    pub fn finish(&self, id: u64) {
        self.ops.lock().unwrap().remove(&id);
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpProgress {
    pub op_id: u64,
    pub done_files: u64,
    pub total_files: u64,
    pub done_bytes: u64,
    pub total_bytes: u64,
    pub current: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpDone {
    pub op_id: u64,
    pub ok: bool,
    pub canceled: bool,
    pub error: Option<String>,
    /// Pastas/arquivos criados no destino (a UI seleciona/atualiza).
    pub created: Vec<String>,
}

/// Um item planejado: arquivo de origem → destino.
struct PlannedFile {
    src: PathBuf,
    dest: PathBuf,
    bytes: u64,
}

struct Plan {
    /// Pastas a criar no destino, em ordem (pais antes dos filhos).
    dirs: Vec<PathBuf>,
    files: Vec<PlannedFile>,
    total_bytes: u64,
    /// Symlinks são pulados de propósito (evita ciclo e semântica ambígua).
    skipped_symlinks: u64,
}

/// Erro amigável com o caminho no texto (vai pro toast da UI).
fn err_at(path: &Path, e: impl std::fmt::Display) -> String {
    format!("{}: {}", path.display(), e)
}

/// Destino livre: se `wanted` já existe, tenta "nome (2)", "nome (3)"…
pub fn unique_target(wanted: &Path) -> PathBuf {
    if !wanted.exists() {
        return wanted.to_path_buf();
    }
    let parent = wanted.parent().map(Path::to_path_buf).unwrap_or_default();
    let stem = wanted
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let ext = wanted
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    for n in 2u32.. {
        let candidate = parent.join(format!("{stem} ({n}){ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!()
}

/// Varre `src` (arquivo ou pasta) e planeja a cópia pra dentro de `dest_root`.
fn plan_one(src: &Path, dest: &Path, plan: &mut Plan) -> Result<(), String> {
    let meta = fs::symlink_metadata(src).map_err(|e| err_at(src, e))?;
    if meta.file_type().is_symlink() {
        plan.skipped_symlinks += 1;
        return Ok(());
    }
    if meta.is_dir() {
        plan.dirs.push(dest.to_path_buf());
        let rd = fs::read_dir(src).map_err(|e| err_at(src, e))?;
        for entry in rd {
            let entry = entry.map_err(|e| err_at(src, e))?;
            plan_one(&entry.path(), &dest.join(entry.file_name()), plan)?;
        }
    } else {
        let bytes = meta.len();
        plan.total_bytes += bytes;
        plan.files.push(PlannedFile {
            src: src.to_path_buf(),
            dest: dest.to_path_buf(),
            bytes,
        });
    }
    Ok(())
}

/// Copia um arquivo em blocos, checando cancelamento e reportando bytes.
fn copy_file_chunked(
    file: &PlannedFile,
    cancel: &AtomicBool,
    mut on_bytes: impl FnMut(u64),
) -> Result<(), String> {
    let mut reader = fs::File::open(&file.src).map_err(|e| err_at(&file.src, e))?;
    let mut writer = fs::File::create(&file.dest).map_err(|e| err_at(&file.dest, e))?;
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        if cancel.load(Ordering::Relaxed) {
            drop(writer);
            let _ = fs::remove_file(&file.dest); // não deixa arquivo pela metade
            return Err("canceled".into());
        }
        let n = reader.read(&mut buf).map_err(|e| err_at(&file.src, e))?;
        if n == 0 {
            break;
        }
        writer.write_all(&buf[..n]).map_err(|e| err_at(&file.dest, e))?;
        on_bytes(n as u64);
    }
    // Preserva o mtime "de graça" não dá com std puro; fica pro futuro se pedir.
    Ok(())
}

/// Guarda contra copiar/mover uma pasta pra dentro dela mesma.
fn dest_inside_source(sources: &[PathBuf], dest_dir: &Path) -> bool {
    sources.iter().any(|s| dest_dir.starts_with(s))
}

pub enum Mode {
    Copy,
    Move,
}

/// Executa a operação (já numa thread). Emite progresso e o evento final.
pub fn run_transfer(
    app: &AppHandle,
    op_id: u64,
    cancel: Arc<AtomicBool>,
    sources: Vec<PathBuf>,
    dest_dir: PathBuf,
    mode: Mode,
) {
    let result = transfer_inner(app, op_id, &cancel, sources, dest_dir, &mode);
    let canceled = cancel.load(Ordering::Relaxed);
    let (ok, error, created) = match result {
        Ok(created) => (true, None, created),
        Err(e) if e == "canceled" => (false, None, vec![]),
        Err(e) => (false, Some(e), vec![]),
    };
    let _ = app.emit(
        "fileop-done",
        OpDone {
            op_id,
            ok: ok && !canceled,
            canceled,
            error,
            created,
        },
    );
}

fn transfer_inner(
    app: &AppHandle,
    op_id: u64,
    cancel: &AtomicBool,
    sources: Vec<PathBuf>,
    dest_dir: PathBuf,
    mode: &Mode,
) -> Result<Vec<String>, String> {
    if !dest_dir.is_dir() {
        return Err(format!("destino não é uma pasta: {}", dest_dir.display()));
    }
    if dest_inside_source(&sources, &dest_dir) {
        return Err("não dá pra copiar/mover uma pasta pra dentro dela mesma".into());
    }

    let mut created: Vec<String> = Vec::new();
    let mut pending_walk: Vec<(PathBuf, PathBuf)> = Vec::new();

    // MOVE, caminho rápido: rename no mesmo volume (instantâneo, sem varrer).
    if matches!(mode, Mode::Move) {
        for src in &sources {
            if cancel.load(Ordering::Relaxed) {
                return Err("canceled".into());
            }
            let name = src
                .file_name()
                .ok_or_else(|| format!("origem inválida: {}", src.display()))?;
            // Mover pro mesmo lugar = no-op (não duplicar com " (2)").
            if src.parent() == Some(dest_dir.as_path()) {
                continue;
            }
            let dest = unique_target(&dest_dir.join(name));
            match fs::rename(src, &dest) {
                Ok(()) => created.push(dest.to_string_lossy().into_owned()),
                // Cross-volume (EXDEV etc.): cai pro plano copiar+remover.
                Err(_) => pending_walk.push((src.clone(), dest)),
            }
        }
    } else {
        for src in &sources {
            let name = src
                .file_name()
                .ok_or_else(|| format!("origem inválida: {}", src.display()))?;
            let dest = unique_target(&dest_dir.join(name));
            pending_walk.push((src.clone(), dest));
        }
    }

    if pending_walk.is_empty() {
        return Ok(created);
    }

    // Planeja tudo (total de bytes/arquivos pro progresso ser honesto).
    let mut plan = Plan {
        dirs: vec![],
        files: vec![],
        total_bytes: 0,
        skipped_symlinks: 0,
    };
    let roots: Vec<(PathBuf, PathBuf)> = pending_walk;
    for (src, dest) in &roots {
        plan_one(src, dest, &mut plan)?;
        created.push(dest.to_string_lossy().into_owned());
    }

    for dir in &plan.dirs {
        if cancel.load(Ordering::Relaxed) {
            return Err("canceled".into());
        }
        fs::create_dir_all(dir).map_err(|e| err_at(dir, e))?;
    }

    let total_files = plan.files.len() as u64;
    let mut done_files = 0u64;
    let mut done_bytes = 0u64;
    let mut last_emit = Instant::now();

    for file in &plan.files {
        if cancel.load(Ordering::Relaxed) {
            return Err("canceled".into());
        }
        let current = file
            .src
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        copy_file_chunked(file, cancel, |n| {
            done_bytes += n;
            if last_emit.elapsed().as_millis() >= 150 {
                last_emit = Instant::now();
                let _ = app.emit(
                    "fileop-progress",
                    OpProgress {
                        op_id,
                        done_files,
                        total_files,
                        done_bytes,
                        total_bytes: plan.total_bytes,
                        current: current.clone(),
                    },
                );
            }
        })?;
        done_files += 1;
        let _ = app.emit(
            "fileop-progress",
            OpProgress {
                op_id,
                done_files,
                total_files,
                done_bytes,
                total_bytes: plan.total_bytes,
                current,
            },
        );
        let _ = file.bytes; // (usado no plano; progresso vai por bytes reais)
    }

    // MOVE (fallback copiado): só remove a origem depois de TUDO copiado.
    if matches!(mode, Mode::Move) {
        for (src, _dest) in &roots {
            let meta = fs::symlink_metadata(src).map_err(|e| err_at(src, e))?;
            let r = if meta.is_dir() {
                fs::remove_dir_all(src)
            } else {
                fs::remove_file(src)
            };
            r.map_err(|e| err_at(src, e))?;
        }
    }

    Ok(created)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unique_target_devolve_o_proprio_se_livre() {
        let p = std::env::temp_dir().join("localfiles-nao-existe-xyz.txt");
        assert_eq!(unique_target(&p), p);
    }

    #[test]
    fn unique_target_sufixa_quando_existe() {
        let dir = std::env::temp_dir().join("localfiles-test-unique");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let f = dir.join("a.txt");
        fs::write(&f, b"x").unwrap();
        assert_eq!(unique_target(&f), dir.join("a (2).txt"));
        fs::write(dir.join("a (2).txt"), b"x").unwrap();
        assert_eq!(unique_target(&f), dir.join("a (3).txt"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn transfer_guard_pasta_dentro_dela_mesma() {
        let dir = std::env::temp_dir().join("localfiles-test-guard");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("sub")).unwrap();
        assert!(dest_inside_source(&[dir.clone()], &dir.join("sub")));
        assert!(!dest_inside_source(&[dir.join("sub")], &dir));
        let _ = fs::remove_dir_all(&dir);
    }
}
