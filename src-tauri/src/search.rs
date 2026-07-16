//! Busca recursiva (nome e, opcionalmente, conteúdo) com streaming e
//! cancelamento. Resultados saem em lotes pelo evento `search-result`;
//! o fim (total/truncado/cancelado) pelo `search-done`.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::{entry_from, is_hidden, Entry};

/// Teto de resultados (a UI é virtualizada, mas memória/ruído têm limite).
const MAX_RESULTS: usize = 2000;
/// Conteúdo: só arquivos até este tamanho entram na busca por conteúdo.
const MAX_CONTENT_BYTES: u64 = 1024 * 1024;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SearchBatch {
    op_id: u64,
    entries: Vec<Entry>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SearchDone {
    op_id: u64,
    total: usize,
    truncated: bool,
    canceled: bool,
}

/// Arquivo "parece texto"? (sem NUL no primeiro bloco.)
fn looks_textual(bytes: &[u8]) -> bool {
    !bytes.iter().take(1024).any(|b| *b == 0)
}

/// Busca `needle` (já minúsculo) no conteúdo do arquivo, caso-insensível.
fn content_matches(path: &Path, needle_lower: &str, size: u64) -> bool {
    if size > MAX_CONTENT_BYTES {
        return false;
    }
    let Ok(bytes) = std::fs::read(path) else {
        return false;
    };
    if !looks_textual(&bytes) {
        return false;
    }
    String::from_utf8_lossy(&bytes).to_lowercase().contains(needle_lower)
}

pub fn run_search(
    app: AppHandle,
    op_id: u64,
    cancel: Arc<AtomicBool>,
    root: String,
    query: String,
    in_content: bool,
    show_hidden: bool,
) {
    let needle = query.to_lowercase();
    let mut batch: Vec<Entry> = Vec::new();
    let mut total = 0usize;
    let mut truncated = false;
    let mut last_emit = Instant::now();

    // jwalk: varredura paralela; a poda de ocultos acontece já na leitura de
    // cada diretório (senão a busca desce em AppData/.git etc. sem precisar).
    let walker = jwalk::WalkDir::new(&root)
        .skip_hidden(false)
        .follow_links(false)
        .process_read_dir(move |_depth, _path, _state, children| {
            if !show_hidden {
                children.retain(|c| {
                    c.as_ref()
                        .map(|e| {
                            let name = e.file_name().to_string_lossy().into_owned();
                            let hidden_meta = e
                                .metadata()
                                .map(|m| is_hidden(&m, &name))
                                .unwrap_or(false);
                            !hidden_meta && !name.starts_with('.')
                        })
                        .unwrap_or(false)
                });
            }
        });

    for item in walker {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let Ok(e) = item else { continue };
        // A raiz da própria busca não é resultado.
        if e.depth() == 0 {
            continue;
        }
        let name = e.file_name().to_string_lossy().into_owned();
        let name_hit = !needle.is_empty() && name.to_lowercase().contains(&needle);

        let Ok(meta) = e.metadata() else { continue };
        let is_dir = meta.is_dir();
        let hit = if name_hit {
            true
        } else if in_content && !is_dir {
            content_matches(&e.path(), &needle, meta.len())
        } else {
            false
        };
        if !hit {
            continue;
        }

        batch.push(entry_from(&e.path(), &meta, name));
        total += 1;
        if total >= MAX_RESULTS {
            truncated = true;
        }

        if batch.len() >= 50 || last_emit.elapsed().as_millis() >= 200 {
            let _ = app.emit(
                "search-result",
                SearchBatch { op_id, entries: std::mem::take(&mut batch) },
            );
            last_emit = Instant::now();
        }
        if truncated {
            break;
        }
    }

    if !batch.is_empty() {
        let _ = app.emit("search-result", SearchBatch { op_id, entries: batch });
    }
    let _ = app.emit(
        "search-done",
        SearchDone {
            op_id,
            total,
            truncated,
            canceled: cancel.load(Ordering::Relaxed),
        },
    );
}
