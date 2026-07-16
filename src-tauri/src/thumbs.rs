//! Miniaturas de imagem (grade/preview) e leitura do começo de arquivo de
//! texto (preview). Thumbnail vira PNG em cache no disco (app_cache) keyed
//! por caminho+mtime+tamanho — mudou o arquivo, muda a chave.

use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::Read;
use std::path::PathBuf;

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Manager};

/// Extensões que tentamos decodificar (as que o crate `image` cobre bem).
const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "tiff"];
/// Imagem acima disso nem tenta (decodificar 200 MB pra um thumb não vale).
const MAX_IMAGE_BYTES: u64 = 64 * 1024 * 1024;

fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("thumbs");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn cache_key(path: &str, mtime: i64, size: u64, max_dim: u32) -> String {
    let mut h = DefaultHasher::new();
    (path, mtime, size, max_dim).hash(&mut h);
    format!("{:016x}.png", h.finish())
}

fn to_data_url(png: &[u8]) -> String {
    format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png))
}

/// Miniatura como data-URL PNG, ou `None` se não é imagem suportada.
#[tauri::command(async)]
pub fn thumbnail(app: AppHandle, path: String, max_dim: u32) -> Result<Option<String>, String> {
    let p = PathBuf::from(&path);
    let ext = p
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !IMAGE_EXTS.contains(&ext.as_str()) {
        return Ok(None);
    }
    let meta = fs::metadata(&p).map_err(|e| format!("{path}: {e}"))?;
    if meta.len() > MAX_IMAGE_BYTES {
        return Ok(None);
    }
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let dir = cache_dir(&app)?;
    let cached = dir.join(cache_key(&path, mtime, meta.len(), max_dim));
    if let Ok(png) = fs::read(&cached) {
        return Ok(Some(to_data_url(&png)));
    }

    let img = image::open(&p).map_err(|e| format!("{path}: {e}"))?;
    let thumb = img.thumbnail(max_dim, max_dim);
    let mut png: Vec<u8> = Vec::new();
    thumb
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    // Cache é melhor-esforço: falhou gravar, segue sem cache.
    let _ = fs::write(&cached, &png);
    Ok(Some(to_data_url(&png)))
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TextHead {
    pub text: String,
    pub truncated: bool,
}

/// Começo de um arquivo de texto pro painel de preview (UTF-8 tolerante).
#[tauri::command(async)]
pub fn read_text_head(path: String, max_bytes: usize) -> Result<TextHead, String> {
    let mut f = fs::File::open(&path).map_err(|e| format!("{path}: {e}"))?;
    let cap = max_bytes.min(256 * 1024);
    let mut buf = vec![0u8; cap + 1];
    let mut read = 0usize;
    while read < buf.len() {
        let n = f.read(&mut buf[read..]).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        read += n;
    }
    let truncated = read > cap;
    let slice = &buf[..read.min(cap)];
    if slice.iter().take(1024).any(|b| *b == 0) {
        return Err("binário".into());
    }
    Ok(TextHead {
        text: String::from_utf8_lossy(slice).into_owned(),
        truncated,
    })
}
