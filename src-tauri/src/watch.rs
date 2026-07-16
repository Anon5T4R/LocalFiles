//! Watcher da pasta ativa: qualquer mudança feita por fora (outro app, outro
//! processo) vira um evento `dir-changed` debounced — a UI atualiza sozinha.
//! Um watcher por vez (a aba ativa); trocar de pasta troca o watcher.

use std::path::Path;
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use notify::{RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

/// Guarda o watcher vivo; substituir dropa o anterior (para a thread dele).
#[derive(Default)]
pub struct WatchState(Mutex<Option<notify::RecommendedWatcher>>);

pub fn watch_dir(app: &AppHandle, state: &WatchState, path: String) -> Result<(), String> {
    let (tx, rx) = mpsc::channel::<()>();

    let mut watcher = notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
        if res.is_ok() {
            let _ = tx.send(());
        }
    })
    .map_err(|e| e.to_string())?;

    watcher
        .watch(Path::new(&path), RecursiveMode::NonRecursive)
        .map_err(|e| format!("{path}: {e}"))?;

    // Thread de debounce: espera 400 ms de silêncio antes de avisar a UI
    // (uma cópia grande gera centenas de eventos — a UI só precisa de um).
    let handle = app.clone();
    let dir = path.clone();
    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            while rx.recv_timeout(Duration::from_millis(400)).is_ok() {}
            let _ = handle.emit("dir-changed", dir.clone());
        }
        // Sender dropado (watcher substituído/encerrado): thread morre junto.
    });

    // Substitui o watcher anterior (drop para o antigo).
    *state.0.lock().unwrap() = Some(watcher);
    Ok(())
}
