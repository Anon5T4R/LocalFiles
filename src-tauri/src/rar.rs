//! RAR — **só leitura e extração**, pela mesma porta do zip/7z/tar.
//!
//! # Procedência
//!
//! Adaptado do `rar.rs` do **LocalZip v0.5.0** (mesmo autor, mesma suíte,
//! licença MIT). Vieram de lá, sem mudança de comportamento: a descoberta de
//! volumes ([`volume_set`], que conhece as DUAS numerações), o desembrulho de
//! erro ([`classify`]) e o `CountingWriter`. O que mudou aqui é só o destino do
//! progresso (os eventos do LocalFiles) e o **remapeamento de nome da raiz**,
//! que o LocalZip não tem porque lá "extrair" sempre despeja numa pasta nova.
//!
//! Crate: [`rars`] 0.4 — 100% Rust, MIT OR Apache-2.0, `unsafe_code = "forbid"`,
//! zero dependência nativa. Por ser código compilado pelo cargo (e não binário
//! baixado em tempo de build), não entra na regra de espelho do `Local-runtimes`.
//!
//! # Duas numerações de volume, e nenhuma sai de um `sort()` ingênuo
//!
//! * **Nova (RAR 3+/RAR5):** `foo.part1.rar`, `foo.part2.rar` (largura varia).
//! * **Antiga (RAR 2/3):** `foo.rar`, `foo.r00`, `foo.r01` — o PRIMEIRO volume
//!   é o `.rar`, não o `.r00`.
//!
//! Nada disso é o corte cru `.001` do `split.rs`: lá o arquivo foi picado com
//! tesoura; aqui cada volume é um RAR completo, e um membro pode começar num e
//! terminar no outro.
//!
//! # Senha: fora de escopo (ver o cabeçalho do `archive.rs`)
//!
//! Nunca passamos senha pro `rars`. Membro cifrado vira `NEED_PASSWORD` e a UI
//! manda abrir no LocalZip.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use rars::{Archive, ArchiveReadOptions, ArchiveReader, ExtractedEntryMeta};

use crate::archive::{norm_inner, safe_join, selected, AEntry, Reporter};

// ---------- descoberta de volumes ----------

/// `foo.part07.rar` → (`foo`, 7, 2). Só o padrão NOVO.
fn part_suffix(path: &Path) -> Option<(PathBuf, usize, usize)> {
    let name = path.file_name()?.to_str()?;
    let lower = name.to_lowercase();
    let rest = lower.strip_suffix(".rar")?;
    let (stem, num) = rest.rsplit_once(".part")?;
    if num.is_empty() || !num.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let n: usize = num.parse().ok()?;
    // Recorta do nome ORIGINAL (preserva as maiúsculas do usuário).
    Some((path.with_file_name(&name[..stem.len()]), n, num.len()))
}

/// `foo.r00` → `foo.rar` (na numeração antiga o 1º volume é o `.rar`).
fn old_naming_head(path: &Path) -> Option<PathBuf> {
    let name = path.file_name()?.to_str()?;
    let lower = name.to_lowercase();
    let (stem, num) = lower.rsplit_once(".r")?;
    if num.len() != 2 || !num.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some(path.with_file_name(format!("{}.rar", &name[..stem.len()])))
}

/// O nome é volume RAR da numeração antiga (`foo.r07`)? A detecção de formato
/// usa isso: `.r07` não termina em `.rar` mas é RAR do mesmo jeito.
pub fn is_old_volume_name(lower: &str) -> bool {
    match lower.rsplit_once(".r") {
        Some((stem, num)) => {
            !stem.is_empty() && num.len() == 2 && num.bytes().all(|b| b.is_ascii_digit())
        }
        None => false,
    }
}

/// Os volumes do conjunto, EM ORDEM, entrando por qualquer um deles. Um RAR
/// comum devolve um vetor de 1 — o chamador não precisa saber a diferença.
pub fn volume_set(path: &Path) -> Vec<PathBuf> {
    if !path.to_string_lossy().to_lowercase().ends_with(".rar") {
        if let Some(head) = old_naming_head(path) {
            if head.is_file() {
                return volume_set(&head);
            }
        }
        return vec![path.to_path_buf()];
    }

    // Numeração nova: `foo.partN.rar`.
    if let Some((base, _, width)) = part_suffix(path) {
        let mut out = Vec::new();
        let mut i = 1usize;
        loop {
            let p = base.with_file_name(format!(
                "{}.part{:0width$}.rar",
                base.file_name().unwrap_or_default().to_string_lossy(),
                i
            ));
            if !p.is_file() {
                break;
            }
            out.push(p);
            i += 1;
        }
        if !out.is_empty() {
            return out;
        }
        return vec![path.to_path_buf()];
    }

    // Numeração antiga: `foo.rar` + `foo.r00`, `foo.r01`, …
    let stem = path.with_extension("");
    let stem_name = stem.file_name().unwrap_or_default().to_string_lossy().into_owned();
    let mut out = vec![path.to_path_buf()];
    let mut i = 0usize;
    loop {
        let p = stem.with_file_name(format!("{stem_name}.r{i:02}"));
        if !p.is_file() {
            break;
        }
        out.push(p);
        i += 1;
    }
    out
}

// ---------- erros ----------

/// Desembrulha `AtEntry`/`AtArchiveOffset` até o erro de verdade.
fn root_cause(e: &rars::Error) -> &rars::Error {
    match e {
        rars::Error::AtEntry { source, .. } | rars::Error::AtArchiveOffset { source, .. } => {
            root_cause(source)
        }
        other => other,
    }
}

/// Traduz o erro do crate pros códigos que a UI já sabe mostrar. Sem senha na
/// mão, "senha errada ou dado corrompido" é sempre "faltou senha".
fn classify(e: &rars::Error) -> String {
    match root_cause(e) {
        rars::Error::NeedPassword | rars::Error::WrongPasswordOrCorruptData => {
            "NEED_PASSWORD".into()
        }
        rars::Error::Io(io) if io.message.contains("canceled") => "canceled".into(),
        other => other.to_string(),
    }
}

fn parse_volumes(vols: &[PathBuf]) -> Result<Vec<Archive>, String> {
    let opts = ArchiveReadOptions::with_optional_password(None);
    let mut out = Vec::with_capacity(vols.len());
    for v in vols {
        out.push(ArchiveReader::read_path_with_options(v, opts).map_err(|e| classify(&e))?);
    }
    Ok(out)
}

// ---------- listagem ----------

/// Índice do RAR (ou do conjunto) sem descompactar nada.
///
/// Um membro que atravessa a fronteira de volume aparece no cabeçalho de CADA
/// volume que toca; `is_split_before` marca as continuações e elas são puladas —
/// senão um arquivo em 3 volumes viraria 3 entradas na lista.
pub fn list(path: &str) -> Result<Vec<AEntry>, String> {
    let archives = parse_volumes(&volume_set(Path::new(path)))?;
    let mut entries = Vec::new();
    for a in &archives {
        for m in a.members() {
            let meta = &m.meta;
            if meta.is_split_before {
                continue;
            }
            let inner = norm_inner(&meta.name_lossy());
            if inner.is_empty() {
                continue;
            }
            entries.push(AEntry {
                path: inner,
                is_dir: meta.is_directory,
                size: meta.unpacked_size,
                modified_ms: dos_time_ms(meta.file_time),
                encrypted: meta.is_encrypted,
            });
        }
    }
    Ok(entries)
}

/// Timestamp DOS/FAT (o que o RAR guarda) → epoch-ms.
fn dos_time_ms(t: Option<u32>) -> i64 {
    let Some(t) = t else { return 0 };
    if t == 0 {
        return 0;
    }
    let (y, mo, d) = (
        1980 + ((t >> 25) & 0x7f) as i64,
        ((t >> 21) & 0x0f) as i64,
        ((t >> 16) & 0x1f) as i64,
    );
    let (h, mi, s) = (
        ((t >> 11) & 0x1f) as i64,
        ((t >> 5) & 0x3f) as i64,
        ((t & 0x1f) * 2) as i64,
    );
    if mo == 0 || d == 0 {
        return 0;
    }
    let a = (14 - mo) / 12;
    let y2 = y + 4800 - a;
    let m2 = mo + 12 * a - 3;
    let jdn = d + (153 * m2 + 2) / 5 + 365 * y2 + y2 / 4 - y2 / 100 + y2 / 400 - 32045;
    ((jdn - 2440588) * 86400 + h * 3600 + mi * 60 + s) * 1000
}

// ---------- extração ----------

/// Escritor que conta bytes e obedece o cancelamento. Precisa ser `'static`
/// (o `rars` pede `Box<dyn Write>`), então é DONO de tudo que usa.
struct CountingWriter {
    inner: Box<dyn Write>,
    rep: Arc<Mutex<Reporter>>,
    cancel: Arc<AtomicBool>,
    name: String,
}

impl Write for CountingWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        if self.cancel.load(Ordering::Relaxed) {
            return Err(io::Error::new(io::ErrorKind::Interrupted, "canceled"));
        }
        let n = self.inner.write(buf)?;
        if let Ok(mut r) = self.rep.lock() {
            r.bytes(n as u64, &self.name);
        }
        Ok(n)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

/// Extrai os itens selecionados, com a raiz renomeada conforme `roots`
/// (`[(caminho interno selecionado, nome final no destino)]`).
pub fn extract(
    cancel: &Arc<AtomicBool>,
    archive: &str,
    dest_dir: &Path,
    filter: &Option<Vec<String>>,
    roots: &[(String, String)],
    rep: Arc<Mutex<Reporter>>,
) -> Result<(), String> {
    let archives = parse_volumes(&volume_set(Path::new(archive)))?;
    // Erro do NOSSO lado (criar pasta, zip-slip): o `rars` só deixa devolver
    // `rars::Error`, então o motivo de verdade fica guardado aqui.
    let own_err: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));

    let open = |meta: &ExtractedEntryMeta| -> rars::Result<Box<dyn Write>> {
        if cancel.load(Ordering::Relaxed) {
            return Err(rars::Error::from(io::Error::new(
                io::ErrorKind::Interrupted,
                "canceled",
            )));
        }
        let inner = norm_inner(&meta.name_lossy());
        if inner.is_empty() || !selected(&inner, filter) {
            // Não selecionado: o fluxo PRECISA ser consumido do mesmo jeito (o
            // RAR é sequencial, e sólido ainda por cima), então vai pro ralo.
            return Ok(Box::new(io::sink()));
        }
        let Some(rel) = crate::archive::remap(&inner, roots) else {
            return Ok(Box::new(io::sink()));
        };
        let target = match safe_join(dest_dir, &rel) {
            Ok(t) => t,
            Err(e) => {
                *own_err.lock().unwrap() = Some(e);
                return Err(rars::Error::InvalidHeader("caminho suspeito no arquivo"));
            }
        };
        let mk = |e: std::io::Error| {
            *own_err.lock().unwrap() = Some(format!("{}: {e}", target.display()));
            rars::Error::from(e)
        };
        if meta.is_directory {
            fs::create_dir_all(&target).map_err(mk)?;
            return Ok(Box::new(io::sink()));
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(mk)?;
        }
        let f = fs::File::create(&target).map_err(mk)?;
        if let Ok(mut r) = rep.lock() {
            r.file_done(&inner);
        }
        Ok(Box::new(CountingWriter {
            inner: Box::new(io::BufWriter::new(f)),
            rep: rep.clone(),
            cancel: cancel.clone(),
            name: inner,
        }))
    };

    let r = if archives.len() > 1 {
        rars::extract_volumes_to(&archives, None, open)
    } else {
        archives[0].extract_to(None, open)
    };

    if let Err(e) = r {
        if cancel.load(Ordering::Relaxed) {
            return Err("canceled".into());
        }
        if let Some(own) = own_err.lock().unwrap().take() {
            return Err(own);
        }
        return Err(classify(&e));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("localfiles-rar-{name}"));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn nome_de_volume_antigo_e_reconhecido() {
        assert!(is_old_volume_name("foo.r00"));
        assert!(is_old_volume_name("foo.r07"));
        // 1 dígito, 3 dígitos e "sem nome" não são volume.
        assert!(!is_old_volume_name("foo.r0"));
        assert!(!is_old_volume_name("foo.r007"));
        assert!(!is_old_volume_name(".r00"));
        assert!(!is_old_volume_name("foo.rar"));
    }

    #[test]
    fn volume_set_acha_as_duas_numeracoes_na_ordem_certa() {
        // Sem fixture RAR de verdade: o que se testa aqui é a DESCOBERTA de
        // nomes no disco, que é onde mora a pegadinha da ordem.
        let d = tmp("volumes");

        // Numeração nova: part1..part3, entrando por QUALQUER volume.
        for i in 1..=3 {
            fs::write(d.join(format!("novo.part{i}.rar")), b"x").unwrap();
        }
        let v = volume_set(&d.join("novo.part2.rar"));
        assert_eq!(v.len(), 3, "{v:?}");
        assert!(v[0].to_string_lossy().ends_with("part1.rar"));
        assert!(v[2].to_string_lossy().ends_with("part3.rar"));

        // Numeração antiga: o `.rar` é o PRIMEIRO, não o `.r00`.
        fs::write(d.join("velho.rar"), b"x").unwrap();
        fs::write(d.join("velho.r00"), b"x").unwrap();
        fs::write(d.join("velho.r01"), b"x").unwrap();
        let v = volume_set(&d.join("velho.rar"));
        assert_eq!(v.len(), 3, "{v:?}");
        assert!(v[0].to_string_lossy().ends_with("velho.rar"));
        assert!(v[1].to_string_lossy().ends_with(".r00"));
        // Entrar pelo `.r01` acha o MESMO conjunto, na mesma ordem.
        assert_eq!(volume_set(&d.join("velho.r01")), v);

        // RAR de um volume só continua sendo um vetor de 1.
        fs::write(d.join("sozinho.rar"), b"x").unwrap();
        assert_eq!(volume_set(&d.join("sozinho.rar")).len(), 1);

        let _ = fs::remove_dir_all(&d);
    }
}
