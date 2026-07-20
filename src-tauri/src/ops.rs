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

    /// Registra uma operação com id escolhido pelo CHAMADOR. A busca usa isso:
    /// o front gera o op_id de forma síncrona antes do invoke, senão os
    /// primeiros eventos `search-result`/`search-done` chegam antes da promise
    /// resolver e são descartados por opId desconhecido. Os ids do front vivem
    /// numa faixa própria (>= 2^32) pra nunca colidir com os do `register()`.
    pub fn register_with_id(&self, id: u64) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.ops.lock().unwrap().insert(id, flag.clone());
        flag
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
    /// Links simbólicos que NÃO foram copiados (ver o comentário do move entre
    /// volumes). Quando isso é > 0 num "mover", a origem foi preservada de
    /// propósito e a UI avisa — senão o usuário acha que moveu tudo.
    #[serde(default)]
    pub skipped_symlinks: u64,
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

/// Caminho pronto pra chamada de sistema no Windows, driblando o `MAX_PATH`.
///
/// **Medido, não suposto** (teste `caminho_longo_no_windows`): sem isso, criar
/// um arquivo com caminho de ~300 caracteres falha com "O nome do arquivo ou a
/// extensão é muito grande" — o `std::fs` do Rust chama a API `…W` do Windows,
/// que é limitada a 260 caracteres a menos que o caminho venha com o prefixo
/// `\\?\`. Isso morde de verdade ao extrair um zip com árvore profunda pra
/// dentro de uma pasta que já é profunda: o limite é do caminho FINAL, e nem o
/// zip nem a pasta destino são longos sozinhos.
///
/// Duas cautelas:
///
/// 1. O prefixo desliga a normalização do sistema (`.`, `..`, barra normal),
///    então só é aplicado em caminho **absoluto** — os nossos vêm de listagem
///    de diretório e já estão canônicos.
/// 2. O resultado é pra **chamar o sistema**, nunca pra mostrar na UI nem pra
///    devolver pro front: um `\\?\C:\…` vazando na lista não casaria com o
///    caminho que o `list_dir` devolve, e a seleção pararia de funcionar.
///
/// Fora do Windows é identidade (não existe limite equivalente).
#[cfg(windows)]
pub fn long_path(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    if s.starts_with("\\\\?\\") || s.starts_with("\\\\.\\") {
        return p.to_path_buf();
    }
    // UNC (`\\servidor\share`) tem prefixo próprio.
    if let Some(rest) = s.strip_prefix("\\\\") {
        return PathBuf::from(format!("\\\\?\\UNC\\{}", rest.replace('/', "\\")));
    }
    // Só caminho absoluto com unidade ("C:\…").
    let b = s.as_bytes();
    if b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/')
    {
        return PathBuf::from(format!("\\\\?\\{}", s.replace('/', "\\")));
    }
    p.to_path_buf()
}

#[cfg(not(windows))]
pub fn long_path(p: &Path) -> PathBuf {
    p.to_path_buf()
}

/// Destino livre: se `wanted` já existe, tenta "nome (2)", "nome (3)"…
pub fn unique_target(wanted: &Path) -> PathBuf {
    // `long_path` só na PERGUNTA ao sistema; o caminho devolvido é o original,
    // porque ele vira string na UI e tem que casar com o que o `list_dir` mostra.
    let existe = |p: &Path| long_path(p).exists();
    if !existe(wanted) {
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
        if !existe(&candidate) {
            return candidate;
        }
    }
    unreachable!()
}

/// Varre `src` (arquivo ou pasta) e planeja a cópia pra dentro de `dest_root`.
fn plan_one(src: &Path, dest: &Path, plan: &mut Plan) -> Result<(), String> {
    let meta = fs::symlink_metadata(long_path(src)).map_err(|e| err_at(src, e))?;
    if meta.file_type().is_symlink() {
        plan.skipped_symlinks += 1;
        return Ok(());
    }
    if meta.is_dir() {
        plan.dirs.push(dest.to_path_buf());
        let rd = fs::read_dir(long_path(src)).map_err(|e| err_at(src, e))?;
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
    let (src_io, dest_io) = (long_path(&file.src), long_path(&file.dest));
    let mut reader = fs::File::open(&src_io).map_err(|e| err_at(&file.src, e))?;
    let mut writer = fs::File::create(&dest_io).map_err(|e| err_at(&file.dest, e))?;
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        if cancel.load(Ordering::Relaxed) {
            drop(writer);
            let _ = fs::remove_file(&dest_io); // não deixa arquivo pela metade
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
    let (ok, error, created, skipped_symlinks) = match result {
        Ok((created, skipped)) => (true, None, created, skipped),
        Err(e) if e == "canceled" => (false, None, vec![], 0),
        Err(e) => (false, Some(e), vec![], 0),
    };
    let _ = app.emit(
        "fileop-done",
        OpDone {
            op_id,
            ok: ok && !canceled,
            canceled,
            error,
            created,
            skipped_symlinks,
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
) -> Result<(Vec<String>, u64), String> {
    if !long_path(&dest_dir).is_dir() {
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
        return Ok((created, 0));
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
        fs::create_dir_all(long_path(dir)).map_err(|e| err_at(dir, e))?;
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

    // ---- MOVE entre volumes diferentes: a parte perigosa ----
    //
    // Aqui não houve `rename` — houve CÓPIA, e agora viria o apagar. É o único
    // ponto do app onde um erro custa o arquivo do usuário, então nada é
    // apagado por otimismo:
    //
    // * qualquer erro/cancelamento acima já saiu por `?` sem chegar aqui (a
    //   origem fica inteira, o destino pode ter sobras — sobra é recuperável,
    //   falta não é);
    // * antes de apagar, CONFERE: todo arquivo planejado tem que existir no
    //   destino com o tamanho certo. Um `write_all` que devolveu `Ok` num disco
    //   que encheu, ou um destino removido no meio do caminho, morrem aqui em
    //   vez de virarem "sumiu";
    // * se algum symlink foi PULADO na cópia, a origem não é apagada de jeito
    //   nenhum: o `remove_dir_all` levaria junto um link que nunca foi copiado.
    //   Vira uma cópia bem-sucedida + aviso, e o usuário decide.
    if matches!(mode, Mode::Move) {
        for file in &plan.files {
            let meta = fs::metadata(long_path(&file.dest))
                .map_err(|e| format!("conferência falhou, origem preservada — {}", err_at(&file.dest, e)))?;
            if meta.len() != file.bytes {
                return Err(format!(
                    "conferência falhou, origem preservada — {}: esperava {} bytes, achei {}",
                    file.dest.display(),
                    file.bytes,
                    meta.len()
                ));
            }
        }
        if plan.skipped_symlinks == 0 {
            for (src, _dest) in &roots {
                let meta = fs::symlink_metadata(long_path(src)).map_err(|e| err_at(src, e))?;
                let r = if meta.is_dir() {
                    fs::remove_dir_all(long_path(src))
                } else {
                    fs::remove_file(long_path(src))
                };
                r.map_err(|e| err_at(src, e))?;
            }
        }
    }

    Ok((created, plan.skipped_symlinks))
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

    /// Diretório temporário limpo pro teste.
    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("localfiles-ops-{name}"));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    /// Roda uma transferência SEM AppHandle (o `transfer_inner` só emite
    /// evento pelo `app`, então os testes exercitam a lógica de verdade
    /// chamando as peças puras). Aqui a gente replica o miolo do `run_transfer`
    /// sem o Tauri: planejar, copiar e apagar.
    fn mover_ou_copiar(
        sources: Vec<PathBuf>,
        dest_dir: &Path,
        is_move: bool,
        forcar_cross_volume: bool,
    ) -> Result<(Vec<String>, u64), String> {
        let cancel = AtomicBool::new(false);
        let mode = if is_move { Mode::Move } else { Mode::Copy };
        let mut created: Vec<String> = Vec::new();
        let mut pending: Vec<(PathBuf, PathBuf)> = Vec::new();

        if matches!(mode, Mode::Move) {
            for src in &sources {
                let name = src.file_name().ok_or("origem inválida")?;
                if src.parent() == Some(dest_dir) {
                    continue;
                }
                let dest = unique_target(&dest_dir.join(name));
                // `forcar_cross_volume` finge que o `rename` falhou (EXDEV) —
                // é assim que se exercita o caminho copiar+apagar sem precisar
                // de dois discos de verdade na máquina de teste.
                let renamed = if forcar_cross_volume {
                    Err(std::io::Error::other("EXDEV simulado"))
                } else {
                    fs::rename(src, &dest)
                };
                match renamed {
                    Ok(()) => created.push(dest.to_string_lossy().into_owned()),
                    Err(_) => pending.push((src.clone(), dest)),
                }
            }
        } else {
            for src in &sources {
                let name = src.file_name().ok_or("origem inválida")?;
                pending.push((src.clone(), unique_target(&dest_dir.join(name))));
            }
        }
        if pending.is_empty() {
            return Ok((created, 0));
        }

        let mut plan = Plan { dirs: vec![], files: vec![], total_bytes: 0, skipped_symlinks: 0 };
        for (src, dest) in &pending {
            plan_one(src, dest, &mut plan)?;
            created.push(dest.to_string_lossy().into_owned());
        }
        for dir in &plan.dirs {
            fs::create_dir_all(long_path(dir)).map_err(|e| err_at(dir, e))?;
        }
        for file in &plan.files {
            copy_file_chunked(file, &cancel, |_| {})?;
        }
        if matches!(mode, Mode::Move) {
            for file in &plan.files {
                let meta = fs::metadata(long_path(&file.dest))
                    .map_err(|e| format!("conferência falhou, origem preservada — {}", err_at(&file.dest, e)))?;
                if meta.len() != file.bytes {
                    return Err("conferência falhou, origem preservada".into());
                }
            }
            if plan.skipped_symlinks == 0 {
                for (src, _) in &pending {
                    let meta = fs::symlink_metadata(long_path(src)).map_err(|e| err_at(src, e))?;
                    if meta.is_dir() {
                        fs::remove_dir_all(long_path(src))
                    } else {
                        fs::remove_file(long_path(src))
                    }
                    .map_err(|e| err_at(src, e))?;
                }
            }
        }
        Ok((created, plan.skipped_symlinks))
    }

    #[test]
    fn mover_entre_volumes_copia_apaga_e_confere_o_conteudo() {
        // O caso perigoso do item: entre volumes diferentes NÃO existe rename —
        // é copiar + apagar, e o conteúdo tem que chegar inteiro do outro lado.
        // Aqui o EXDEV é simulado; o que se prova é o CAMINHO, não o driver.
        let d = tmp("cross-volume");
        let origem = d.join("origem");
        let destino = d.join("destino");
        fs::create_dir_all(origem.join("pasta/sub")).unwrap();
        fs::create_dir_all(&destino).unwrap();
        // Conteúdo grande o bastante pra passar por vários blocos de 1 MB.
        let gordo: Vec<u8> = (0..3_000_000u32).map(|i| (i % 251) as u8).collect();
        fs::write(origem.join("pasta/grande.bin"), &gordo).unwrap();
        fs::write(origem.join("pasta/sub/nota.txt"), b"texto no fundo").unwrap();
        fs::write(origem.join("solto.txt"), b"na raiz").unwrap();

        let (created, pulados) = mover_ou_copiar(
            vec![origem.join("pasta"), origem.join("solto.txt")],
            &destino,
            true,
            true,
        )
        .unwrap();
        assert_eq!(pulados, 0);
        assert_eq!(created.len(), 2);

        // Chegou: byte a byte, com a árvore preservada.
        assert_eq!(fs::read(destino.join("pasta/grande.bin")).unwrap(), gordo);
        assert_eq!(
            fs::read_to_string(destino.join("pasta/sub/nota.txt")).unwrap(),
            "texto no fundo"
        );
        assert_eq!(fs::read_to_string(destino.join("solto.txt")).unwrap(), "na raiz");
        // E saiu: mover é copiar E apagar (só depois de conferir).
        assert!(!origem.join("pasta").exists(), "a origem deveria ter sumido");
        assert!(!origem.join("solto.txt").exists());

        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn mover_entre_volumes_falhando_no_meio_preserva_a_origem() {
        // A regra inegociável: se a cópia não terminar, o arquivo do usuário
        // continua onde estava. O erro é forçado apontando o destino pra um
        // caminho impossível DEPOIS do plano.
        let d = tmp("cross-volume-falha");
        let origem = d.join("origem");
        fs::create_dir_all(&origem).unwrap();
        fs::write(origem.join("precioso.txt"), b"nao me perca").unwrap();

        // Destino que não é diretório: o `create` do arquivo destino falha.
        let destino_ruim = d.join("arquivo-no-lugar-da-pasta");
        fs::write(&destino_ruim, b"sou um arquivo, nao uma pasta").unwrap();

        let r = mover_ou_copiar(vec![origem.join("precioso.txt")], &destino_ruim, true, true);
        assert!(r.is_err(), "deveria falhar, veio {r:?}");
        // O ponto do teste: a origem sobreviveu, com o conteúdo intacto.
        assert_eq!(
            fs::read_to_string(origem.join("precioso.txt")).unwrap(),
            "nao me perca",
            "mover falhou no meio e AINDA ASSIM apagou a origem"
        );

        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn nome_que_ja_existe_no_destino_nao_sobrescreve() {
        // Vale nos dois modos e também pra PASTA (não só arquivo).
        let d = tmp("colisao");
        let origem = d.join("origem");
        let destino = d.join("destino");
        fs::create_dir_all(origem.join("dados")).unwrap();
        fs::create_dir_all(destino.join("dados")).unwrap();
        fs::write(origem.join("dados/novo.txt"), b"versao da origem").unwrap();
        fs::write(destino.join("dados/antigo.txt"), b"ja estava aqui").unwrap();
        fs::write(origem.join("a.txt"), b"origem").unwrap();
        fs::write(destino.join("a.txt"), b"destino original").unwrap();

        mover_ou_copiar(vec![origem.join("a.txt")], &destino, false, false).unwrap();
        assert_eq!(fs::read_to_string(destino.join("a.txt")).unwrap(), "destino original");
        assert_eq!(fs::read_to_string(destino.join("a (2).txt")).unwrap(), "origem");

        // Pasta homônima: a que existia continua íntegra, a nova vira "dados (2)".
        mover_ou_copiar(vec![origem.join("dados")], &destino, true, true).unwrap();
        assert_eq!(
            fs::read_to_string(destino.join("dados/antigo.txt")).unwrap(),
            "ja estava aqui"
        );
        assert_eq!(
            fs::read_to_string(destino.join("dados (2)/novo.txt")).unwrap(),
            "versao da origem"
        );

        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn caminho_longo_no_windows() {
        // MEDIÇÃO, não suposição: monta um caminho de mais de 260 caracteres e
        // prova que (a) sem o prefixo `\\?\` o Windows recusa, e (b) com ele
        // funciona — que é exatamente o que o `long_path` faz.
        let d = tmp("longo");
        // Segmentos de 40 chars até passar de 300 no total.
        let mut fundo = d.clone();
        while fundo.to_string_lossy().len() < 300 {
            fundo = fundo.join("um-segmento-de-nome-bem-comprido-mesmo");
        }
        let total = fundo.to_string_lossy().len();
        assert!(total > 260, "o caminho de teste tem só {total} chars");

        // Criar a árvore JÁ precisa do prefixo no Windows.
        fs::create_dir_all(long_path(&fundo)).unwrap_or_else(|e| panic!("{total} chars: {e}"));
        let alvo = fundo.join("arquivo.txt");

        #[cfg(windows)]
        {
            // (a) Sem prefixo: o Windows recusa. Se um dia isso PASSAR (o
            // usuário ligou o LongPathsEnabled no registro), o teste não mente
            // — ele só deixa de exercitar o caso, então avisa em vez de falhar.
            match fs::write(&alvo, b"sem prefixo") {
                Err(e) => eprintln!("[MEDIDO] {total} chars sem \\\\?\\ → recusado: {e}"),
                Ok(()) => {
                    eprintln!("[MEDIDO] {total} chars sem \\\\?\\ PASSOU (LongPathsEnabled ligado nesta máquina)");
                    let _ = fs::remove_file(&alvo);
                }
            }
        }

        // (b) Com prefixo funciona sempre, e o conteúdo volta certo.
        fs::write(long_path(&alvo), b"com prefixo").unwrap_or_else(|e| panic!("{total} chars: {e}"));
        assert_eq!(fs::read_to_string(long_path(&alvo)).unwrap(), "com prefixo");
        assert!(long_path(&alvo).exists());

        // E copiar pra dentro desse caminho longo funciona pelo motor de verdade.
        let origem = d.join("curto.txt");
        fs::write(&origem, b"vim de um caminho curto").unwrap();
        mover_ou_copiar(vec![origem.clone()], &fundo, false, false)
            .unwrap_or_else(|e| panic!("copiar pro caminho longo: {e}"));
        assert_eq!(
            fs::read_to_string(long_path(&fundo.join("curto.txt"))).unwrap(),
            "vim de um caminho curto"
        );

        let _ = fs::remove_dir_all(long_path(&d));
    }

    #[test]
    fn long_path_so_mexe_no_que_deve() {
        // Caminho já prefixado não ganha prefixo de novo.
        let ja = Path::new(r"\\?\C:\x\y");
        assert_eq!(long_path(ja), ja);
        // Relativo fica como está (o prefixo desligaria a resolução).
        assert_eq!(long_path(Path::new("relativo/x")), Path::new("relativo/x"));

        #[cfg(windows)]
        {
            assert_eq!(long_path(Path::new(r"C:\x\y")), Path::new(r"\\?\C:\x\y"));
            // UNC tem prefixo próprio.
            assert_eq!(
                long_path(Path::new(r"\\servidor\share\a")),
                Path::new(r"\\?\UNC\servidor\share\a")
            );
        }
        #[cfg(not(windows))]
        {
            // Fora do Windows é identidade — não existe limite equivalente.
            assert_eq!(long_path(Path::new("/home/joao/x")), Path::new("/home/joao/x"));
        }
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
