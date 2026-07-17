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

/// Diretórios podados por NOME durante a varredura: pesadíssimos e quase
/// nunca são o que o usuário procura. Lista curta e conservadora de
/// propósito. A poda só vale com "mostrar ocultos" DESLIGADO — com ocultos
/// ligados o usuário está pedindo pra ver tudo, inclusive isso.
const PRUNED_DIRS: [&str; 5] = [
    "node_modules",
    "target",
    ".git",
    "$RECYCLE.BIN",
    "System Volume Information",
];

/// Diretório que a busca não desce (comparação ASCII caso-insensível,
/// suficiente pra lista acima).
fn is_pruned_dir(name: &str) -> bool {
    PRUNED_DIRS.iter().any(|d| name.eq_ignore_ascii_case(d))
}

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
///
/// Limitação assumida: a insensibilidade a caixa no CONTEÚDO é só ASCII
/// (comparação janelada byte a byte, sem alocar uma cópia minúscula do
/// arquivo inteiro — antes era `from_utf8_lossy(...).to_lowercase()` do
/// arquivo todo, caro em memória e CPU). Busca por NOME segue
/// Unicode-insensível como sempre foi.
fn content_matches(path: &Path, needle_lower: &str, size: u64) -> bool {
    if size > MAX_CONTENT_BYTES || needle_lower.is_empty() {
        return false;
    }
    let Ok(bytes) = std::fs::read(path) else {
        return false;
    };
    if !looks_textual(&bytes) {
        return false;
    }
    let needle = needle_lower.as_bytes();
    bytes
        .windows(needle.len())
        .any(|w| w.eq_ignore_ascii_case(needle))
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
                            // Poda por nome (node_modules, target, .git...):
                            // `file_type` vem de graça do read_dir, sem stat.
                            if e.file_type().is_dir() && is_pruned_dir(&name) {
                                return false;
                            }
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

        // Sem chance de hit, nem stata: `metadata()` é um syscall por entrada,
        // serializado aqui no consumidor — no Windows isso dominava o tempo da
        // busca por nome. Só paga o stat quem pode virar resultado.
        if !name_hit && !in_content {
            continue;
        }
        let Ok(meta) = e.metadata() else { continue };
        let is_dir = meta.is_dir();
        let hit = name_hit || (in_content && !is_dir && content_matches(&e.path(), &needle, meta.len()));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn poda_diretorios_pesados_por_nome() {
        assert!(is_pruned_dir("node_modules"));
        assert!(is_pruned_dir("Target")); // caso-insensível
        assert!(is_pruned_dir(".git"));
        assert!(is_pruned_dir("$RECYCLE.BIN"));
        assert!(is_pruned_dir("system volume information"));
        // Não pode virar poda agressiva:
        assert!(!is_pruned_dir("targets"));
        assert!(!is_pruned_dir("meu_target"));
        assert!(!is_pruned_dir("src"));
    }

    #[test]
    fn conteudo_casa_ascii_insensivel_sem_alocar() {
        let dir = std::env::temp_dir();
        let path = dir.join("localfiles_search_test_content.txt");
        std::fs::write(&path, "Linha um\nHELLO World\nfim").unwrap();
        let size = std::fs::metadata(&path).unwrap().len();

        assert!(content_matches(&path, "hello", size));
        assert!(content_matches(&path, "hello w", size));
        assert!(content_matches(&path, "linha", size));
        assert!(!content_matches(&path, "ausente", size));
        // Needle vazio nunca casa (guarda contra windows(0)).
        assert!(!content_matches(&path, "", size));
        // Needle maior que o arquivo não casa (nem estoura).
        assert!(!content_matches(&path, &"x".repeat(1000), size));
        // Acima do teto de tamanho, nem lê.
        assert!(!content_matches(&path, "hello", MAX_CONTENT_BYTES + 1));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn conteudo_binario_nao_casa() {
        let dir = std::env::temp_dir();
        let path = dir.join("localfiles_search_test_bin.dat");
        std::fs::write(&path, b"abc\x00hello").unwrap();
        let size = std::fs::metadata(&path).unwrap().len();
        assert!(!content_matches(&path, "hello", size));
        let _ = std::fs::remove_file(&path);
    }
}
