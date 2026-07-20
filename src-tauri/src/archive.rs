//! Zip inline — entrar num arquivo compactado como se fosse uma pasta.
//!
//! # Procedência
//!
//! Este módulo é uma **adaptação do `archive.rs` do LocalZip v0.5.0** (mesmo
//! autor, mesma suíte, licença MIT). O que veio de lá, praticamente literal:
//!
//! * [`detect_format`], [`norm_inner`], [`safe_join`] e [`selected`] — inclusive
//!   a regra de que o formato de um volume de corte cru sai do nome SEM o
//!   sufixo numérico (`foo.zip.001` é zip);
//! * a leitura de índice sem descompactar (`by_index_raw` no zip, cabeçalho no
//!   7z, streaming no tar) e o cuidado com entrada de PASTA marcada como
//!   cifrada, que fazia `by_index_decrypt` estourar "senha incorreta" com a
//!   senha certa;
//! * o `SplitReader` inteiro (ver `split.rs`) e o módulo `rar.rs`;
//! * o truque do [`add_to_zip`]: `ZipWriter::new_append` acrescenta no fim sem
//!   nem LER os bytes antigos (custo O(novos), não O(arquivo)).
//!
//! O que é **novo aqui** e não existe no LocalZip:
//!
//! * a visão de PASTA ([`children_of`]): o LocalZip calcula os filhos diretos de
//!   um diretório interno no front (`zpath.ts`); aqui isso mora no Rust pra a
//!   listagem de dentro do zip devolver o mesmo `Entry` da listagem de disco —
//!   assim a lista, a ordenação, a seleção e a barra de status funcionam sem
//!   saber que estão dentro de um arquivo compactado;
//! * o **cache de índice** ([`ArchiveCache`]): navegar entre pastas de um zip
//!   relia o diretório central a cada passo. Com o cache, só a primeira entrada
//!   custa (medido no teste `cache_evita_reler_o_indice`);
//! * a regra de colisão da suíte aplicada nos DOIS sentidos — extrair pra uma
//!   pasta que já tem o nome vira "nome (2)", e adicionar um nome que já existe
//!   dentro do zip TAMBÉM vira "nome (2)" em vez de substituir calado (o
//!   LocalZip substitui de propósito: lá "adicionar" é um comando explícito de
//!   compactador; aqui é um "colar", e colar nunca sobrescreve na suíte).
//!
//! # Fora de escopo (assumido, não é pendência)
//!
//! Arquivo com SENHA é só-leitura do índice: extrair devolve `NEED_PASSWORD` e
//! a UI manda abrir no LocalZip, que tem o diálogo de senha. Duplicar essa UI
//! aqui daria dois lugares pra consertar o mesmo bug.

use std::collections::HashSet;
use std::fs;
use std::io::{Read, Seek, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use sevenz_rust2::{ArchiveReader, Password};
use tauri::{AppHandle, Emitter};

use crate::ops::{OpDone, OpProgress};
use crate::rar;
use crate::split::{self, SplitReader};
use crate::Entry;

/// Separador entre o arquivo no disco e o caminho DENTRO dele.
///
/// `C:\docs\a.zip::fotos/praia.jpg`. Duas letras porque um caminho do Windows
/// já tem um `:` (a unidade) e um só seria ambíguo; `::` não aparece em caminho
/// de Windows nenhum. No Linux é um nome de arquivo legal, mas raríssimo — e o
/// custo do caso raro é abrir a pasta errada, não perder dado.
pub const VSEP: &str = "::";

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Format {
    Zip,
    Tar,
    TarGz,
    TarXz,
    TarBz2,
    TarZst,
    SevenZ,
    Rar,
}

/// Uma entrada crua do índice (caminho achatado, como está no arquivo).
#[derive(Clone)]
pub struct AEntry {
    /// Caminho DENTRO do arquivo, separador "/", sem barra no fim.
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_ms: i64,
    pub encrypted: bool,
}

// ---------- caminho virtual ----------

/// Quebra `C:\x\a.zip::fotos/praia.jpg` em (`C:\x\a.zip`, `fotos/praia.jpg`).
/// Devolve `None` quando não é caminho virtual (é um caminho de disco comum).
pub fn split_virtual(path: &str) -> Option<(String, String)> {
    let idx = path.find(VSEP)?;
    let archive = path[..idx].to_string();
    let inner = norm_inner(&path[idx + VSEP.len()..]);
    Some((archive, inner))
}

/// Monta o caminho virtual (inner vazio = raiz do arquivo).
pub fn join_virtual(archive: &str, inner: &str) -> String {
    format!("{archive}{VSEP}{inner}")
}

// ---------- detecção de formato ----------

/// Copiado do LocalZip: o formato de um volume de corte cru mora no nome SEM o
/// sufixo numérico (`foo.zip.001` é zip; `foo.tar.gz.002` é tar.gz).
pub fn detect_format(path: &str) -> Result<Format, String> {
    let base = split::volume_base_name(Path::new(path)).unwrap_or_else(|| path.to_string());
    let lower = base.to_lowercase();
    if lower.ends_with(".rar") || rar::is_old_volume_name(&lower) {
        Ok(Format::Rar)
    } else if lower.ends_with(".zip") {
        Ok(Format::Zip)
    } else if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        Ok(Format::TarGz)
    } else if lower.ends_with(".tar.xz") || lower.ends_with(".txz") {
        Ok(Format::TarXz)
    } else if lower.ends_with(".tar.bz2") || lower.ends_with(".tbz2") || lower.ends_with(".tbz") {
        Ok(Format::TarBz2)
    } else if lower.ends_with(".tar.zst") || lower.ends_with(".tzst") {
        Ok(Format::TarZst)
    } else if lower.ends_with(".tar") {
        Ok(Format::Tar)
    } else if lower.ends_with(".7z") {
        Ok(Format::SevenZ)
    } else {
        Err("NOT_AN_ARCHIVE".into())
    }
}

/// O caminho de disco parece um arquivo que a gente sabe abrir? (A UI usa isso
/// pra decidir se um duplo-clique ENTRA no arquivo ou manda pro app padrão.)
pub fn is_supported(path: &str) -> bool {
    detect_format(path).is_ok()
}

/// Copiado do LocalZip: "/" como separador, sem "./" nem barra nas pontas.
pub fn norm_inner(raw: &str) -> String {
    let s = raw.replace('\\', "/");
    let s = s.strip_prefix("./").unwrap_or(&s);
    s.trim_matches('/').to_string()
}

/// Copiado do LocalZip: junta destino + caminho interno SANITIZADO (zip-slip —
/// componente ".."/absoluto/unidade é rejeitado, nada escapa do destino).
pub fn safe_join(dest: &Path, inner: &str) -> Result<PathBuf, String> {
    let mut out = dest.to_path_buf();
    for comp in Path::new(&inner.replace('\\', "/")).components() {
        match comp {
            Component::Normal(c) => out.push(c),
            Component::CurDir => {}
            _ => return Err(format!("caminho suspeito no arquivo: {inner}")),
        }
    }
    Ok(out)
}

/// Copiado do LocalZip: o item está entre os selecionados? (igual ou descendente)
pub fn selected(inner: &str, filter: &Option<Vec<String>>) -> bool {
    match filter {
        None => true,
        Some(list) => list.iter().any(|p| inner == p || inner.starts_with(&format!("{p}/"))),
    }
}

fn open_reader(path: &str) -> Result<SplitReader, String> {
    if split::multi_disk_zip(Path::new(path)) {
        return Err("MULTI_DISK_ZIP".into());
    }
    SplitReader::open(path)
}

fn tar_reader(file: SplitReader, format: Format) -> Box<dyn Read> {
    match format {
        Format::Tar => Box::new(file),
        Format::TarGz => Box::new(flate2::read::GzDecoder::new(file)),
        Format::TarXz => Box::new(xz2::read::XzDecoder::new(file)),
        Format::TarBz2 => Box::new(bzip2::read::BzDecoder::new(file)),
        Format::TarZst => Box::new(zstd::stream::read::Decoder::new(file).expect("zstd")),
        Format::Zip | Format::SevenZ | Format::Rar => unreachable!(),
    }
}

/// Epoch-ms a partir do DateTime do zip (conversão manual, sem crate de datas —
/// igualzinho ao LocalZip).
fn zip_dos_time_ms(f: &zip::read::ZipFile) -> i64 {
    let Some(dt) = f.last_modified() else { return 0 };
    let (y, mo, d, h, mi, s) = (
        dt.year() as i64,
        dt.month() as i64,
        dt.day() as i64,
        dt.hour() as i64,
        dt.minute() as i64,
        dt.second() as i64,
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

// ---------- leitura do índice ----------

/// Índice achatado do arquivo, SEM descompactar nada.
pub fn list_flat(path: &str) -> Result<Vec<AEntry>, String> {
    let format = detect_format(path)?;
    let mut entries: Vec<AEntry> = Vec::new();

    match format {
        Format::Rar => entries = rar::list(path)?,
        Format::Zip => {
            let mut za = zip::ZipArchive::new(open_reader(path)?).map_err(|e| e.to_string())?;
            for i in 0..za.len() {
                // by_index_raw: só o cabeçalho, sem descompactar.
                let f = za.by_index_raw(i).map_err(|e| e.to_string())?;
                let inner = norm_inner(f.name());
                if inner.is_empty() {
                    continue;
                }
                entries.push(AEntry {
                    path: inner,
                    is_dir: f.is_dir(),
                    size: f.size(),
                    modified_ms: zip_dos_time_ms(&f),
                    encrypted: f.encrypted(),
                });
            }
        }
        Format::SevenZ => {
            let reader =
                ArchiveReader::new(open_reader(path)?, Password::empty()).map_err(|e| e.to_string())?;
            for f in &reader.archive().files {
                let inner = norm_inner(&f.name);
                if inner.is_empty() {
                    continue;
                }
                entries.push(AEntry {
                    path: inner,
                    is_dir: f.is_directory,
                    size: f.size,
                    modified_ms: 0,
                    encrypted: false,
                });
            }
        }
        _ => {
            let mut ar = tar::Archive::new(tar_reader(open_reader(path)?, format));
            for entry in ar.entries().map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let inner =
                    norm_inner(&entry.path().map_err(|e| e.to_string())?.to_string_lossy());
                if inner.is_empty() {
                    continue;
                }
                entries.push(AEntry {
                    path: inner,
                    is_dir: entry.header().entry_type().is_dir(),
                    size: entry.header().size().unwrap_or(0),
                    modified_ms: entry.header().mtime().unwrap_or(0) as i64 * 1000,
                    encrypted: false,
                });
            }
        }
    }
    Ok(entries)
}

// ---------- cache do índice ----------

/// Índice do último arquivo aberto, com a assinatura do arquivo no disco.
///
/// Navegar por 5 níveis de um zip fazia 5 leituras do diretório central. Como o
/// LocalFiles ainda re-lista a pasta no `refresh`/watcher, na prática eram
/// muito mais. O cache guarda UM arquivo (é o que a navegação usa) e a chave
/// inclui tamanho+mtime: o zip mudou por fora → a assinatura muda → releitura.
#[derive(Default)]
pub struct ArchiveCache {
    inner: Mutex<Option<(String, u64, i64, Arc<Vec<AEntry>>)>>,
}

impl ArchiveCache {
    /// Assinatura do arquivo no disco (tamanho + mtime). Num conjunto de
    /// volumes olha o volume pelo qual entramos — trocar um volume no meio sem
    /// mudar nem tamanho nem data é caso que não se defende.
    fn stamp(path: &str) -> (u64, i64) {
        match fs::metadata(path) {
            Ok(m) => (
                m.len(),
                m.modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0),
            ),
            Err(_) => (0, 0),
        }
    }

    pub fn get(&self, path: &str) -> Result<Arc<Vec<AEntry>>, String> {
        let (len, mtime) = Self::stamp(path);
        {
            let guard = self.inner.lock().unwrap();
            if let Some((p, l, m, entries)) = guard.as_ref() {
                if p == path && *l == len && *m == mtime {
                    return Ok(entries.clone());
                }
            }
        }
        let entries = Arc::new(list_flat(path)?);
        *self.inner.lock().unwrap() = Some((path.to_string(), len, mtime, entries.clone()));
        Ok(entries)
    }

    /// Esquece o que estiver guardado (depois de escrever no arquivo).
    pub fn invalidate(&self) {
        *self.inner.lock().unwrap() = None;
    }
}

// ---------- visão de pasta ----------

/// Filhos DIRETOS de um diretório interno, como `Entry` (o mesmo struct da
/// listagem de disco — a UI não precisa saber que está dentro de um zip).
///
/// Inclui **pastas implícitas**: zip nem sempre grava uma entrada própria pra
/// pasta, então "a/b/c.txt" sozinho já obriga "a" a existir na raiz. A pasta
/// agrega o tamanho de tudo que está dentro dela (o Explorer mostra "—", mas
/// aqui o número é barato e útil pra saber o que vai custar extrair).
pub fn children_of(archive: &str, entries: &[AEntry], dir: &str) -> Vec<Entry> {
    let prefix = if dir.is_empty() { String::new() } else { format!("{dir}/") };
    // Ordem de inserção preservada não importa (o front ordena), mas o mapa
    // precisa agregar por nome.
    let mut by_name: std::collections::HashMap<String, Entry> = std::collections::HashMap::new();

    for e in entries {
        if e.path == dir || !e.path.starts_with(&prefix) {
            continue;
        }
        let rest = &e.path[prefix.len()..];
        if rest.is_empty() {
            continue;
        }
        let (name, is_direct) = match rest.find('/') {
            Some(i) => (&rest[..i], false),
            None => (rest, true),
        };
        let full = format!("{prefix}{name}");
        let vpath = join_virtual(archive, &full);

        if is_direct && !e.is_dir {
            // Arquivo deste nível: sempre ganha (substitui pasta implícita homônima).
            by_name.insert(
                name.to_string(),
                Entry {
                    name: name.to_string(),
                    path: vpath,
                    is_dir: false,
                    size: e.size,
                    modified_ms: e.modified_ms,
                    ext: name
                        .rsplit_once('.')
                        .map(|(_, x)| x.to_lowercase())
                        .unwrap_or_default(),
                    hidden: name.starts_with('.'),
                    readonly: false,
                    is_symlink: false,
                },
            );
            continue;
        }

        let node = by_name.entry(name.to_string()).or_insert_with(|| Entry {
            name: name.to_string(),
            path: vpath,
            is_dir: true,
            size: 0,
            modified_ms: 0,
            ext: String::new(),
            hidden: name.starts_with('.'),
            readonly: false,
            is_symlink: false,
        });
        if !node.is_dir {
            continue; // arquivo homônimo já ocupou o nome
        }
        if !e.is_dir {
            node.size += e.size;
        }
        if e.modified_ms > node.modified_ms {
            node.modified_ms = e.modified_ms;
        }
    }

    by_name.into_values().collect()
}

// ---------- progresso (reusa os eventos que a UI já escuta) ----------

/// Emite `fileop-progress` — os MESMOS eventos da cópia/movimentação de disco,
/// de propósito: extrair e colar dentro do zip aparecem no painel de operações
/// existente, sem UI nova.
pub struct Reporter {
    app: Option<AppHandle>,
    op_id: u64,
    done_files: u64,
    total_files: u64,
    done_bytes: u64,
    total_bytes: u64,
    last: Instant,
}

impl Reporter {
    pub fn new(app: Option<AppHandle>, op_id: u64, total_files: u64, total_bytes: u64) -> Self {
        Self {
            app,
            op_id,
            done_files: 0,
            total_files,
            done_bytes: 0,
            total_bytes,
            last: Instant::now(),
        }
    }
    pub fn bytes(&mut self, n: u64, current: &str) {
        self.done_bytes += n;
        if self.last.elapsed().as_millis() >= 150 {
            self.emit(current);
        }
    }
    pub fn file_done(&mut self, current: &str) {
        self.done_files += 1;
        self.emit(current);
    }
    fn emit(&mut self, current: &str) {
        self.last = Instant::now();
        let Some(app) = self.app.as_ref() else { return };
        let _ = app.emit(
            "fileop-progress",
            OpProgress {
                op_id: self.op_id,
                done_files: self.done_files,
                total_files: self.total_files,
                done_bytes: self.done_bytes,
                total_bytes: self.total_bytes,
                current: current.to_string(),
            },
        );
    }
}

fn emit_done(app: &AppHandle, op_id: u64, result: Result<Vec<String>, String>, canceled: bool) {
    let (ok, error, created) = match result {
        Ok(c) => (!canceled, None, c),
        Err(e) if e == "canceled" => (false, None, vec![]),
        Err(e) => (false, Some(e), vec![]),
    };
    let _ = app.emit("fileop-done", OpDone { op_id, ok, canceled, error, created, skipped_symlinks: 0 });
}

// ---------- extrair ----------

/// Nome livre em `dest`, considerando o disco E os nomes já reservados nesta
/// mesma operação (dois itens selecionados podem ter o mesmo nome-base).
fn unique_name_in(dest: &Path, name: &str, used: &mut HashSet<String>) -> String {
    let taken = |c: &str, used: &HashSet<String>| dest.join(c).exists() || used.contains(c);
    if !taken(name, used) {
        used.insert(name.to_string());
        return name.to_string();
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (name.to_string(), String::new()),
    };
    for n in 2u32.. {
        let candidate = format!("{stem} ({n}){ext}");
        if !taken(&candidate, used) {
            used.insert(candidate.clone());
            return candidate;
        }
    }
    unreachable!()
}

/// Mapa "raiz interna selecionada → nome final no destino" (aplica a regra de
/// colisão da suíte ANTES de escrever qualquer byte).
fn plan_roots(dest: &Path, inners: &[String]) -> Vec<(String, String)> {
    let mut used = HashSet::new();
    inners
        .iter()
        .map(|root| {
            let base = root.rsplit('/').next().unwrap_or(root);
            (root.clone(), unique_name_in(dest, base, &mut used))
        })
        .collect()
}

/// Reescreve o caminho interno com o nome final da raiz a que ele pertence.
/// `docs/a.txt` com raiz `docs` renomeada pra `docs (2)` vira `docs (2)/a.txt`.
pub(crate) fn remap(inner: &str, roots: &[(String, String)]) -> Option<String> {
    for (root, final_name) in roots {
        if inner == root {
            return Some(final_name.clone());
        }
        if let Some(rest) = inner.strip_prefix(&format!("{root}/")) {
            return Some(format!("{final_name}/{rest}"));
        }
    }
    None
}

pub fn extract(
    app: &AppHandle,
    op_id: u64,
    cancel: Arc<AtomicBool>,
    archive: String,
    inners: Vec<String>,
    dest: String,
) {
    let result = extract_inner(Some(app), op_id, &cancel, &archive, &inners, &dest);
    emit_done(app, op_id, result, cancel.load(Ordering::Relaxed));
}

pub fn extract_inner(
    app: Option<&AppHandle>,
    op_id: u64,
    cancel: &Arc<AtomicBool>,
    archive: &str,
    inners: &[String],
    dest: &str,
) -> Result<Vec<String>, String> {
    // `dest_dir` é o caminho pra CHAMAR o sistema (com `\\?\` no Windows quando
    // precisa); `dest_ui` é o original, que vira string pro front — um `\\?\`
    // vazando na lista não casaria com o que o `list_dir` devolve.
    let dest_ui = Path::new(dest);
    let dest_dir = crate::ops::long_path(dest_ui);
    fs::create_dir_all(&dest_dir).map_err(|e| format!("{dest}: {e}"))?;
    let format = detect_format(archive)?;
    let roots = plan_roots(&dest_dir, inners);
    let created: Vec<String> = roots
        .iter()
        .map(|(_, n)| dest_ui.join(n).to_string_lossy().into_owned())
        .collect();
    let filter = Some(inners.to_vec());

    // Totais do que foi selecionado (progresso honesto).
    let index = list_flat(archive)?;
    let (total_files, total_bytes) = index
        .iter()
        .filter(|e| !e.is_dir && selected(&e.path, &filter))
        .fold((0u64, 0u64), |(f, b), e| (f + 1, b + e.size));
    if index.iter().any(|e| e.encrypted && selected(&e.path, &filter)) {
        return Err("NEED_PASSWORD".into());
    }
    // `Arc<Mutex<…>>` e não `&mut`: o `rars` exige um `Box<dyn Write>` `'static`
    // pra cada membro, então o relator tem que ser DONO compartilhado. Travar um
    // mutex a cada bloco de 512 KB não aparece em medição nenhuma.
    let rep = Arc::new(Mutex::new(Reporter::new(app.cloned(), op_id, total_files, total_bytes)));

    match format {
        Format::Rar => {
            rar::extract(cancel, archive, &dest_dir, &filter, &roots, rep.clone())?;
        }
        Format::Zip => {
            let mut za = zip::ZipArchive::new(open_reader(archive)?).map_err(|e| e.to_string())?;
            for i in 0..za.len() {
                if cancel.load(Ordering::Relaxed) {
                    return Err("canceled".into());
                }
                // Decide pelo cabeçalho CRU, sem abrir o conteúdo (regra herdada
                // do LocalZip: abrir a entrada de PASTA cifrada estourava senha
                // incorreta mesmo com a senha certa).
                let (inner, is_dir) = {
                    let f = za.by_index_raw(i).map_err(|e| e.to_string())?;
                    (norm_inner(f.name()), f.is_dir())
                };
                let Some(rel) = remap(&inner, &roots) else { continue };
                let target = safe_join(&dest_dir, &rel)?;
                if is_dir {
                    fs::create_dir_all(&target).map_err(|e| format!("{}: {e}", target.display()))?;
                    continue;
                }
                let mut f = za.by_index(i).map_err(|e| e.to_string())?;
                write_stream(&mut f, &target, &inner, cancel, &rep)?;
            }
        }
        Format::SevenZ => {
            let mut reader = ArchiveReader::new(open_reader(archive)?, Password::empty())
                .map_err(|e| e.to_string())?;
            // 7z costuma ser sólido: `for_each_entries` decodifica em sequência
            // e o fluxo PRECISA ser consumido mesmo quando não interessa.
            let own_err: Mutex<Option<String>> = Mutex::new(None);
            let r = reader.for_each_entries(|entry, rd| {
                if cancel.load(Ordering::Relaxed) {
                    return Err(sevenz_rust2::Error::Other("canceled".into()));
                }
                let inner = norm_inner(&entry.name);
                let Some(rel) = remap(&inner, &roots) else { return Ok(true) };
                let target = match safe_join(&dest_dir, &rel) {
                    Ok(t) => t,
                    Err(e) => {
                        *own_err.lock().unwrap() = Some(e);
                        return Err(sevenz_rust2::Error::Other("caminho suspeito".into()));
                    }
                };
                if entry.is_directory {
                    fs::create_dir_all(&target)?;
                    return Ok(true);
                }
                if let Err(e) = write_stream(rd, &target, &inner, cancel, &rep) {
                    *own_err.lock().unwrap() = Some(e.clone());
                    return Err(sevenz_rust2::Error::Other(e.into()));
                }
                Ok(true)
            });
            if cancel.load(Ordering::Relaxed) {
                return Err("canceled".into());
            }
            if let Err(e) = r {
                if let Some(own) = own_err.lock().unwrap().take() {
                    return Err(own);
                }
                return Err(match e {
                    sevenz_rust2::Error::PasswordRequired
                    | sevenz_rust2::Error::MaybeBadPassword(_) => "NEED_PASSWORD".to_string(),
                    other => other.to_string(),
                });
            }
        }
        _ => {
            let mut ar = tar::Archive::new(tar_reader(open_reader(archive)?, format));
            for entry in ar.entries().map_err(|e| e.to_string())? {
                if cancel.load(Ordering::Relaxed) {
                    return Err("canceled".into());
                }
                let mut entry = entry.map_err(|e| e.to_string())?;
                let inner =
                    norm_inner(&entry.path().map_err(|e| e.to_string())?.to_string_lossy());
                let etype = entry.header().entry_type();
                if etype.is_symlink() || etype.is_hard_link() {
                    continue; // links não são extraídos (mesma regra do resto do app)
                }
                let Some(rel) = remap(&inner, &roots) else { continue };
                let target = safe_join(&dest_dir, &rel)?;
                if etype.is_dir() {
                    fs::create_dir_all(&target).map_err(|e| format!("{}: {e}", target.display()))?;
                    continue;
                }
                write_stream(&mut entry, &target, &inner, cancel, &rep)?;
            }
        }
    }

    Ok(created)
}

/// Escreve um fluxo no destino em blocos, obedecendo o cancelamento. Cancelar
/// no meio APAGA o arquivo parcial (nada de meio-arquivo com nome de inteiro).
fn write_stream(
    src: &mut (impl Read + ?Sized),
    target: &Path,
    label: &str,
    cancel: &AtomicBool,
    rep: &Arc<Mutex<Reporter>>,
) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    let mut out = fs::File::create(target).map_err(|e| format!("{}: {e}", target.display()))?;
    let mut buf = vec![0u8; 512 * 1024];
    loop {
        if cancel.load(Ordering::Relaxed) {
            drop(out);
            let _ = fs::remove_file(target);
            return Err("canceled".into());
        }
        let n = src.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        out.write_all(&buf[..n]).map_err(|e| format!("{}: {e}", target.display()))?;
        rep.lock().unwrap().bytes(n as u64, label);
    }
    rep.lock().unwrap().file_done(label);
    Ok(())
}

// ---------- adicionar num zip ----------

/// Varre as origens do disco e monta (caminho no disco, caminho interno).
fn walk_sources(sources: &[String], prefix: &str) -> Result<(Vec<(PathBuf, String)>, u64), String> {
    let mut files: Vec<(PathBuf, String)> = Vec::new();
    let mut total = 0u64;

    fn rec(
        disk: &Path,
        inner: &str,
        files: &mut Vec<(PathBuf, String)>,
        total: &mut u64,
    ) -> Result<(), String> {
        let meta = fs::symlink_metadata(disk).map_err(|e| format!("{}: {e}", disk.display()))?;
        if meta.file_type().is_symlink() {
            return Ok(()); // links ficam de fora (mesma regra do ops.rs)
        }
        if meta.is_dir() {
            for entry in fs::read_dir(disk).map_err(|e| format!("{}: {e}", disk.display()))? {
                let entry = entry.map_err(|e| e.to_string())?;
                let name = entry.file_name().to_string_lossy().into_owned();
                rec(&entry.path(), &format!("{inner}/{name}"), files, total)?;
            }
        } else {
            *total += meta.len();
            files.push((disk.to_path_buf(), inner.to_string()));
        }
        Ok(())
    }

    for src in sources {
        let p = crate::ops::long_path(Path::new(src));
        let name = p
            .file_name()
            .ok_or_else(|| format!("origem inválida: {src}"))?
            .to_string_lossy()
            .into_owned();
        rec(&p, &format!("{prefix}{name}"), &mut files, &mut total)?;
    }
    Ok((files, total))
}

pub fn add_to_zip(
    app: &AppHandle,
    op_id: u64,
    cancel: Arc<AtomicBool>,
    archive: String,
    sources: Vec<String>,
    inner_dir: String,
) {
    let result = add_inner(Some(app), op_id, &cancel, &archive, &sources, &inner_dir);
    emit_done(app, op_id, result, cancel.load(Ordering::Relaxed));
}

/// Acrescenta arquivos num zip existente **sem descompactar nada**.
///
/// Herdado do LocalZip: `ZipWriter::new_append` põe o cursor no fim dos dados
/// existentes, escreve os novos e reescreve só o diretório central — os bytes
/// antigos não são nem lidos. Custo O(novos), não O(arquivo).
///
/// A diferença pro LocalZip: lá um nome repetido SUBSTITUI a entrada antiga
/// (o que obriga a reconstruir o arquivo inteiro). Aqui isso é um "colar", e a
/// regra da suíte é nunca sobrescrever calado — então o nome repetido vira
/// "nome (2)". Efeito colateral bom: como nunca há colisão, o caminho de
/// reconstrução simplesmente não é alcançado, e todo "colar dentro do zip" cai
/// no caminho rápido.
pub fn add_inner(
    app: Option<&AppHandle>,
    op_id: u64,
    cancel: &Arc<AtomicBool>,
    archive: &str,
    sources: &[String],
    inner_dir: &str,
) -> Result<Vec<String>, String> {
    if !matches!(detect_format(archive)?, Format::Zip) {
        return Err("ADD_ONLY_ZIP".into());
    }
    if split::volume_parts(Path::new(archive)).is_some() {
        // Escrever de volta num conjunto dividido exigiria re-picar os volumes.
        return Err("ADD_NOT_ON_SPLIT".into());
    }
    if sources.is_empty() {
        return Ok(vec![]);
    }

    let dir = norm_inner(inner_dir);
    let prefix = if dir.is_empty() { String::new() } else { format!("{dir}/") };

    // Nomes que já existem no zip (comparação case-insensitive: o Windows não
    // distingue, e um "Foto.jpg" ao lado de "foto.jpg" quebra na extração).
    let existing: HashSet<String> =
        list_flat(archive)?.iter().map(|e| e.path.to_lowercase()).collect();

    // Renomeia as RAÍZES que colidem (uma pasta inteira vira "pasta (2)/…").
    let mut used: HashSet<String> = HashSet::new();
    let mut roots: Vec<(String, String)> = Vec::new();
    for src in sources {
        let base = Path::new(src)
            .file_name()
            .ok_or_else(|| format!("origem inválida: {src}"))?
            .to_string_lossy()
            .into_owned();
        let mut candidate = base.clone();
        let mut n = 2u32;
        loop {
            let full = format!("{prefix}{candidate}").to_lowercase();
            if !existing.contains(&full) && !used.contains(&full) {
                used.insert(full);
                break;
            }
            let (stem, ext) = match base.rsplit_once('.') {
                Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
                _ => (base.clone(), String::new()),
            };
            candidate = format!("{stem} ({n}){ext}");
            n += 1;
        }
        roots.push((src.clone(), candidate));
    }

    // Varre cada origem já com o nome final da raiz.
    let mut files: Vec<(PathBuf, String)> = Vec::new();
    let mut total_bytes = 0u64;
    for (src, final_name) in &roots {
        let (mut f, b) = walk_sources(std::slice::from_ref(src), &prefix)?;
        // Troca o nome da raiz no caminho interno de cada arquivo varrido.
        let base = Path::new(src).file_name().unwrap().to_string_lossy().into_owned();
        let old_root = format!("{prefix}{base}");
        let new_root = format!("{prefix}{final_name}");
        for (_, inner) in f.iter_mut() {
            if let Some(rest) = inner.strip_prefix(&format!("{old_root}/")) {
                *inner = format!("{new_root}/{rest}");
            } else if *inner == old_root {
                *inner = new_root.clone();
            }
        }
        total_bytes += b;
        files.append(&mut f);
    }

    let mut rep = Reporter::new(app.cloned(), op_id, files.len() as u64, total_bytes);
    let rw = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(archive)
        .map_err(|e| format!("{archive}: {e}"))?;
    let mut zw = zip::ZipWriter::new_append(rw).map_err(|e| e.to_string())?;
    let opts = zip::write::FileOptions::<()>::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .large_file(true);

    for (disk, inner) in &files {
        if cancel.load(Ordering::Relaxed) {
            // Já escrevemos entradas? O `finish` fecha o zip coerente com o que
            // entrou; abortar sem `finish` deixaria o diretório central velho e
            // lixo no fim do arquivo — o zip continuaria válido, mas com bytes
            // órfãos. Fechar é mais barato e mais honesto.
            zw.finish().map_err(|e| e.to_string())?;
            return Err("canceled".into());
        }
        zw.start_file(inner.clone(), opts).map_err(|e| e.to_string())?;
        let mut f = fs::File::open(disk).map_err(|e| format!("{}: {e}", disk.display()))?;
        let mut buf = vec![0u8; 512 * 1024];
        loop {
            let n = f.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            zw.write_all(&buf[..n]).map_err(|e| e.to_string())?;
            rep.bytes(n as u64, inner);
        }
        rep.file_done(inner);
    }
    zw.finish().map_err(|e| e.to_string())?;

    Ok(roots
        .iter()
        .map(|(_, n)| join_virtual(archive, &format!("{prefix}{n}")))
        .collect())
}

// Silencia o aviso do `Seek` importado só pro bound do ZipWriter.
const _: fn() = || {
    fn assert_seek<T: Seek>() {}
    assert_seek::<fs::File>();
};

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("localfiles-arch-{name}"));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    /// Zip de verdade com pastas, sem entrada explícita de diretório (o caso que
    /// obriga a inferir pastas implícitas).
    fn zip_de_teste(dir: &Path) -> PathBuf {
        let z = dir.join("teste.zip");
        let out = fs::File::create(&z).unwrap();
        let mut zw = zip::ZipWriter::new(out);
        let opt = zip::write::SimpleFileOptions::default();
        for (nome, conteudo) in [
            ("raiz.txt", "sou da raiz"),
            ("docs/a.txt", "documento a"),
            ("docs/b.txt", "documento b"),
            ("docs/sub/c.txt", "bem fundo"),
            ("fotos/praia.jpg", "nao e um jpeg de verdade"),
        ] {
            zw.start_file(nome, opt).unwrap();
            zw.write_all(conteudo.as_bytes()).unwrap();
        }
        zw.finish().unwrap();
        z
    }

    #[test]
    fn caminho_virtual_vai_e_volta() {
        let v = join_virtual("C:\\x\\a.zip", "fotos/praia.jpg");
        assert_eq!(v, "C:\\x\\a.zip::fotos/praia.jpg");
        let (a, i) = split_virtual(&v).unwrap();
        assert_eq!(a, "C:\\x\\a.zip");
        assert_eq!(i, "fotos/praia.jpg");
        // Raiz do arquivo: inner vazio.
        let (a, i) = split_virtual("C:\\x\\a.zip::").unwrap();
        assert_eq!((a.as_str(), i.as_str()), ("C:\\x\\a.zip", ""));
        // Caminho de disco comum NÃO é virtual (a unidade tem só um ':').
        assert!(split_virtual("C:\\x\\a.zip").is_none());
        assert!(split_virtual("/home/joao/a.zip").is_none());
    }

    #[test]
    fn detecta_formato_inclusive_em_volume_de_corte_cru() {
        assert_eq!(detect_format("a.zip").unwrap(), Format::Zip);
        assert_eq!(detect_format("a.7z").unwrap(), Format::SevenZ);
        assert_eq!(detect_format("a.tar.gz").unwrap(), Format::TarGz);
        assert_eq!(detect_format("a.rar").unwrap(), Format::Rar);
        // O sufixo numérico não muda o formato (herdado do LocalZip).
        assert_eq!(detect_format("a.zip.001").unwrap(), Format::Zip);
        assert_eq!(detect_format("a.tar.gz.002").unwrap(), Format::TarGz);
        // `.r07` é RAR mesmo sem terminar em `.rar`.
        assert_eq!(detect_format("a.r07").unwrap(), Format::Rar);
        assert!(detect_format("a.txt").is_err());
        assert!(!is_supported("a.txt"));
        assert!(is_supported("a.ZIP"));
    }

    #[test]
    fn navega_no_zip_como_se_fosse_pasta() {
        let d = tmp("navega");
        let z = zip_de_teste(&d);
        let zs = z.to_str().unwrap();
        let idx = list_flat(zs).unwrap();

        // Raiz: 1 arquivo + 2 pastas IMPLÍCITAS (o zip não tem entrada de pasta).
        let raiz = children_of(zs, &idx, "");
        let mut nomes: Vec<_> = raiz.iter().map(|e| e.name.clone()).collect();
        nomes.sort();
        assert_eq!(nomes, vec!["docs", "fotos", "raiz.txt"]);
        let docs = raiz.iter().find(|e| e.name == "docs").unwrap();
        assert!(docs.is_dir);
        // A pasta agrega o tamanho de TUDO abaixo dela, inclusive de "docs/sub".
        assert_eq!(docs.size, ("documento a".len() + "documento b".len() + "bem fundo".len()) as u64);
        // O caminho é virtual e serve pra navegar de novo.
        assert_eq!(docs.path, format!("{zs}::docs"));

        // Um nível abaixo.
        let dentro = children_of(zs, &idx, "docs");
        let mut nomes: Vec<_> = dentro.iter().map(|e| e.name.clone()).collect();
        nomes.sort();
        assert_eq!(nomes, vec!["a.txt", "b.txt", "sub"]);
        let a = dentro.iter().find(|e| e.name == "a.txt").unwrap();
        assert!(!a.is_dir);
        assert_eq!(a.size, "documento a".len() as u64);
        assert_eq!(a.ext, "txt");

        // Fundo, e pasta que não existe devolve vazio (não estoura).
        assert_eq!(children_of(zs, &idx, "docs/sub").len(), 1);
        assert!(children_of(zs, &idx, "naoexiste").is_empty());

        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn extrai_item_avulso_com_conteudo_conferido() {
        let d = tmp("extrai");
        let z = zip_de_teste(&d);
        let zs = z.to_str().unwrap();
        let dest = d.join("saida");
        let cancel = Arc::new(AtomicBool::new(false));

        // Só um arquivo do meio da árvore: sai SOLTO no destino (sem "docs/").
        extract_inner(None, 1, &cancel, zs, &["docs/a.txt".into()], dest.to_str().unwrap()).unwrap();
        assert_eq!(fs::read_to_string(dest.join("a.txt")).unwrap(), "documento a");
        assert!(!dest.join("docs").exists(), "não deveria recriar a árvore acima do item");

        // Uma pasta inteira: sai com a estrutura interna.
        extract_inner(None, 2, &cancel, zs, &["docs".into()], dest.to_str().unwrap()).unwrap();
        assert_eq!(fs::read_to_string(dest.join("docs/b.txt")).unwrap(), "documento b");
        assert_eq!(fs::read_to_string(dest.join("docs/sub/c.txt")).unwrap(), "bem fundo");

        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn extrair_por_cima_nao_sobrescreve_vira_nome_2() {
        // A regra da suíte vale saindo do zip também: o que já estava lá fica.
        let d = tmp("colisao-extrai");
        let z = zip_de_teste(&d);
        let zs = z.to_str().unwrap();
        let dest = d.join("saida");
        fs::create_dir_all(&dest).unwrap();
        fs::write(dest.join("raiz.txt"), b"NAO ME APAGUE").unwrap();
        let cancel = Arc::new(AtomicBool::new(false));

        extract_inner(None, 1, &cancel, zs, &["raiz.txt".into()], dest.to_str().unwrap()).unwrap();
        assert_eq!(fs::read_to_string(dest.join("raiz.txt")).unwrap(), "NAO ME APAGUE");
        assert_eq!(fs::read_to_string(dest.join("raiz (2).txt")).unwrap(), "sou da raiz");

        // Pasta também: "docs" existente → "docs (2)", com o conteúdo dentro.
        fs::create_dir_all(dest.join("docs")).unwrap();
        fs::write(dest.join("docs/marcador"), b"original").unwrap();
        extract_inner(None, 2, &cancel, zs, &["docs".into()], dest.to_str().unwrap()).unwrap();
        assert_eq!(fs::read_to_string(dest.join("docs/marcador")).unwrap(), "original");
        assert_eq!(fs::read_to_string(dest.join("docs (2)/a.txt")).unwrap(), "documento a");
        assert_eq!(fs::read_to_string(dest.join("docs (2)/sub/c.txt")).unwrap(), "bem fundo");

        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn adiciona_no_zip_sem_reextrair_e_sem_sobrescrever() {
        let d = tmp("add");
        let z = zip_de_teste(&d);
        let zs = z.to_str().unwrap();
        let cancel = Arc::new(AtomicBool::new(false));

        // Impressão digital ANTES: (nome, tamanho comprimido, crc). Se algum
        // sobrevivente mudar, houve recompressão.
        let digital = |p: &Path| -> Vec<(String, u64, u32)> {
            let mut za = zip::ZipArchive::new(fs::File::open(p).unwrap()).unwrap();
            (0..za.len())
                .map(|i| {
                    let f = za.by_index_raw(i).unwrap();
                    (f.name().to_string(), f.compressed_size(), f.crc32())
                })
                .collect()
        };
        let antes = digital(&z);

        // Um arquivo novo dentro de "docs".
        let novo = d.join("novo.txt");
        fs::write(&novo, b"entrei depois").unwrap();
        let criados = add_inner(
            None,
            1,
            &cancel,
            zs,
            &[novo.to_string_lossy().into_owned()],
            "docs",
        )
        .unwrap();
        assert_eq!(criados, vec![format!("{zs}::docs/novo.txt")]);

        // Os antigos estão intactos byte a byte (não foram recomprimidos).
        let depois = digital(&z);
        for a in &antes {
            assert!(depois.contains(a), "entrada recomprimida: {a:?}");
        }

        // E o novo é lido de volta pelo caminho normal, no lugar certo.
        let idx = list_flat(zs).unwrap();
        let dentro = children_of(zs, &idx, "docs");
        assert!(dentro.iter().any(|e| e.name == "novo.txt"));
        let out = d.join("conf");
        extract_inner(None, 2, &cancel, zs, &["docs/novo.txt".into()], out.to_str().unwrap())
            .unwrap();
        assert_eq!(fs::read_to_string(out.join("novo.txt")).unwrap(), "entrei depois");

        // COLISÃO: um "a.txt" já existe em docs/ — não pode sumir.
        let outro = d.join("a.txt");
        fs::write(&outro, b"sou o intruso").unwrap();
        let criados =
            add_inner(None, 3, &cancel, zs, &[outro.to_string_lossy().into_owned()], "docs")
                .unwrap();
        assert_eq!(criados, vec![format!("{zs}::docs/a (2).txt")]);
        let out2 = d.join("conf2");
        extract_inner(None, 4, &cancel, zs, &["docs".into()], out2.to_str().unwrap()).unwrap();
        assert_eq!(fs::read_to_string(out2.join("docs/a.txt")).unwrap(), "documento a");
        assert_eq!(fs::read_to_string(out2.join("docs/a (2).txt")).unwrap(), "sou o intruso");

        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn adicionar_recusa_formato_so_leitura_com_codigo_claro() {
        let d = tmp("add-recusa");
        let cancel = Arc::new(AtomicBool::new(false));
        let fonte = d.join("x.txt");
        fs::write(&fonte, b"x").unwrap();
        let src = vec![fonte.to_string_lossy().into_owned()];

        let tgz = d.join("a.tar.gz");
        fs::write(&tgz, b"nao importa").unwrap();
        assert_eq!(
            add_inner(None, 1, &cancel, tgz.to_str().unwrap(), &src, "").unwrap_err(),
            "ADD_ONLY_ZIP"
        );
        let sete = d.join("a.7z");
        fs::write(&sete, b"nao importa").unwrap();
        assert_eq!(
            add_inner(None, 2, &cancel, sete.to_str().unwrap(), &src, "").unwrap_err(),
            "ADD_ONLY_ZIP"
        );
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn cache_evita_reler_o_indice_e_percebe_o_arquivo_mudar() {
        // Um zip com MUITAS entradas: ler o diretório central custa de verdade,
        // então dá pra medir se o cache está funcionando em vez de supor.
        let d = tmp("cache");
        let z = d.join("muitos.zip");
        {
            let out = fs::File::create(&z).unwrap();
            let mut zw = zip::ZipWriter::new(out);
            let opt = zip::write::SimpleFileOptions::default();
            for i in 0..20_000 {
                zw.start_file(format!("pasta{}/arq{i}.txt", i % 50), opt).unwrap();
                zw.write_all(format!("conteudo {i}").as_bytes()).unwrap();
            }
            zw.finish().unwrap();
        }
        let zs = z.to_str().unwrap();
        let cache = ArchiveCache::default();

        let t0 = Instant::now();
        let a = cache.get(zs).unwrap();
        let primeira = t0.elapsed();
        assert_eq!(a.len(), 20_000);

        // 20 navegações seguidas (entrar/sair de pastas do zip).
        let t1 = Instant::now();
        for _ in 0..20 {
            assert_eq!(cache.get(zs).unwrap().len(), 20_000);
        }
        let vinte_no_cache = t1.elapsed();

        eprintln!(
            "[MEDIDO] índice de 20k entradas: 1ª leitura {primeira:?} | 20 acertos de cache {vinte_no_cache:?}"
        );
        assert!(
            vinte_no_cache < primeira,
            "20 acertos de cache ({vinte_no_cache:?}) deveriam custar menos que UMA leitura ({primeira:?})"
        );

        // Mexeu no zip por fora → a assinatura muda → relê (nada de índice velho).
        let novo = d.join("novo.txt");
        fs::write(&novo, b"z").unwrap();
        let cancel = Arc::new(AtomicBool::new(false));
        add_inner(None, 1, &cancel, zs, &[novo.to_string_lossy().into_owned()], "").unwrap();
        assert_eq!(cache.get(zs).unwrap().len(), 20_001, "cache serviu índice velho");

        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn zip_slip_e_bloqueado() {
        let dest = Path::new("/tmp/out");
        assert!(safe_join(dest, "ok/file.txt").is_ok());
        assert!(safe_join(dest, "../fora.txt").is_err());
        assert!(safe_join(dest, "a/../../fora.txt").is_err());
    }

    #[test]
    fn zip_com_senha_recusa_extrair_com_codigo_claro() {
        // Não temos diálogo de senha (é do LocalZip): a extração tem que PARAR
        // com um código que a UI sabe traduzir, não escrever arquivo corrompido.
        let d = tmp("senha");
        let z = d.join("p.zip");
        {
            let out = fs::File::create(&z).unwrap();
            let mut zw = zip::ZipWriter::new(out);
            let opt = zip::write::FileOptions::<()>::default()
                .with_aes_encryption(zip::AesMode::Aes256, "abc123");
            zw.start_file("segredo.txt", opt).unwrap();
            zw.write_all(b"conteudo secreto").unwrap();
            zw.finish().unwrap();
        }
        let zs = z.to_str().unwrap();
        // Listar o índice FUNCIONA (nomes e tamanhos não são cifrados).
        let idx = list_flat(zs).unwrap();
        assert!(idx.iter().any(|e| e.path == "segredo.txt" && e.encrypted));
        assert_eq!(children_of(zs, &idx, "").len(), 1);
        // Extrair para com o código claro.
        let cancel = Arc::new(AtomicBool::new(false));
        let out = d.join("saida");
        let err = extract_inner(None, 1, &cancel, zs, &["segredo.txt".into()], out.to_str().unwrap())
            .unwrap_err();
        assert_eq!(err, "NEED_PASSWORD");
        assert!(!out.join("segredo.txt").exists(), "não pode deixar arquivo pela metade");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn tar_gz_e_sete_z_leem_pelo_mesmo_caminho() {
        // O ponto do item: RAR/7z/tar entram pela MESMA porta que o zip.
        let d = tmp("outros");
        fs::create_dir_all(d.join("src/sub")).unwrap();
        fs::write(d.join("src/a.txt"), b"conteudo a").unwrap();
        fs::write(d.join("src/sub/b.txt"), b"bbbb").unwrap();

        // .7z
        let sete = d.join("t.7z");
        sevenz_rust2::compress_to_path(d.join("src"), &sete).unwrap();
        let ss = sete.to_str().unwrap();
        let idx = list_flat(ss).unwrap();
        assert!(idx.iter().any(|e| e.path.ends_with("a.txt")));
        let cancel = Arc::new(AtomicBool::new(false));
        let raiz = children_of(ss, &idx, "");
        assert!(!raiz.is_empty());
        let out = d.join("out7z");
        // Extrai TUDO o que estiver na raiz do 7z.
        let inners: Vec<String> = raiz.iter().filter_map(|e| split_virtual(&e.path).map(|(_, i)| i)).collect();
        extract_inner(None, 1, &cancel, ss, &inners, out.to_str().unwrap()).unwrap();
        let achou = walkdir_conta(&out);
        assert!(achou >= 2, "7z extraiu {achou} arquivos");

        // .tar.gz
        let tgz = d.join("t.tar.gz");
        {
            let f = fs::File::create(&tgz).unwrap();
            let enc = flate2::write::GzEncoder::new(f, flate2::Compression::default());
            let mut tb = tar::Builder::new(enc);
            tb.append_dir_all("src", d.join("src")).unwrap();
            tb.into_inner().unwrap().finish().unwrap();
        }
        let ts = tgz.to_str().unwrap();
        let idx = list_flat(ts).unwrap();
        let raiz = children_of(ts, &idx, "");
        assert_eq!(raiz.len(), 1, "raiz do tar.gz deveria ter só 'src'");
        assert_eq!(raiz[0].name, "src");
        let dentro = children_of(ts, &idx, "src");
        let mut nomes: Vec<_> = dentro.iter().map(|e| e.name.clone()).collect();
        nomes.sort();
        assert_eq!(nomes, vec!["a.txt", "sub"]);
        let out = d.join("outtgz");
        extract_inner(None, 2, &cancel, ts, &["src/a.txt".into()], out.to_str().unwrap()).unwrap();
        assert_eq!(fs::read_to_string(out.join("a.txt")).unwrap(), "conteudo a");

        let _ = fs::remove_dir_all(&d);
    }

    /// Conta arquivos recursivamente (sem trazer o `walkdir` só pro teste).
    fn walkdir_conta(dir: &Path) -> usize {
        let Ok(rd) = fs::read_dir(dir) else { return 0 };
        rd.flatten()
            .map(|e| {
                if e.path().is_dir() {
                    walkdir_conta(&e.path())
                } else {
                    1
                }
            })
            .sum()
    }
}
