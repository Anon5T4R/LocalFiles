//! "Abrir aqui" — entrega a pasta em foco pro LocalTerminal.
//!
//! # Por que não `openPath()` como fazemos com o LocalZip
//!
//! O caminho barato da suíte (abrir pela ASSOCIAÇÃO do SO, como o `.zip` que
//! vai pro LocalZip) não serve aqui: associação é por EXTENSÃO de arquivo, e o
//! que temos é uma PASTA. Abrir uma pasta pela associação chama o gerenciador
//! de arquivos padrão — que somos nós. Então o exe tem que ser localizado.
//!
//! # Como o exe é localizado
//!
//! Mesma fonte que o TaylorHub usa pro catálogo: a chave `Uninstall` do
//! registro, casando por `DisplayName`. **Não** por PATH — o instalador NSIS
//! do Tauri não põe o app no PATH, então `Command::new("LocalTerminal.exe")`
//! falharia em toda máquina real e funcionaria só na do desenvolvedor.
//!
//! Ordem de busca (a primeira que der certo ganha):
//! 1. `InstallLocation` + `LocalTerminal.exe` (o caso normal);
//! 2. `DisplayIcon` sem o `,0` (instaladores que não gravam InstallLocation);
//! 3. ao lado do NOSSO exe (portátil / dev, quando os dois estão na mesma
//!    pasta) — é o único caminho que funciona sem instalação.
//!
//! Não achar é um resultado ESPERADO (o usuário pode não ter o LocalTerminal),
//! não um erro de programação: vira mensagem dizendo o que instalar.

use std::path::Path;
#[cfg(any(not(windows), test))]
use std::path::PathBuf;

/// Nome do produto como o instalador grava em `DisplayName`.
pub const TERMINAL_DISPLAY_NAME: &str = "LocalTerminal";
#[cfg(windows)]
pub const TERMINAL_EXE: &str = "LocalTerminal.exe";
#[cfg(not(windows))]
pub const TERMINAL_EXE: &str = "localterminal";

/// Apara o valor CRU de `DisplayIcon`.
///
/// Duas formas convivem no registro desta máquina:
/// - NSIS do Tauri (a suíte): `"C:\...\localterminal.exe"` — entre aspas e
///   **sem** o sufixo `,0`;
/// - electron-builder (LocalMind): `C:\...\LocalMind.exe,0` — sem aspas e com
///   o índice do ícone.
///
/// Por isso o corte na vírgula só vale quando o caminho **não** está entre
/// aspas: dentro das aspas a vírgula é parte do caminho (pasta com vírgula no
/// nome é legal no Windows), e quem termina o caminho é o fecha-aspas. Cortar
/// antes de aparar as aspas — como esta função fazia até a v0.6.2 — decepa o
/// caminho na primeira vírgula e a detecção falha calada.
///
/// Mesma regra do `clean_display_icon` do TaylorHub (v0.21.1), portada pra cá.
fn clean_display_icon(raw: &str) -> String {
    let s = raw.trim();
    match s.strip_prefix('"') {
        Some(rest) => rest.split('"').next().unwrap_or("").to_string(),
        None => s.split(',').next().unwrap_or("").trim().to_string(),
    }
}

/// Escolhe o exe a partir dos valores CRUS do registro. Pura de propósito: o
/// caminho difícil (registro sem `InstallLocation`, `DisplayIcon` com `,0`,
/// caminho entre aspas) é exercitável sem mexer no registro da máquina.
pub fn exe_from_registry_values<F>(
    install_location: Option<&str>,
    display_icon: Option<&str>,
    exe_name: &str,
    exists: F,
) -> Option<String>
where
    F: Fn(&Path) -> bool,
{
    if let Some(loc) = install_location.map(str::trim).filter(|s| !s.is_empty()) {
        let cand = Path::new(loc.trim_matches('"').trim()).join(exe_name);
        if exists(&cand) {
            return Some(cand.to_string_lossy().into_owned());
        }
    }
    if let Some(icon) = display_icon.map(str::trim).filter(|s| !s.is_empty()) {
        let raw = clean_display_icon(icon);
        if !raw.is_empty() {
            let p = Path::new(&raw);
            if exists(p) {
                return Some(p.to_string_lossy().into_owned());
            }
        }
    }
    None
}

/// Vizinho do nosso próprio exe (instalação portátil / árvore de dev).
fn exe_beside_ours<F>(our_exe: Option<&Path>, exe_name: &str, exists: F) -> Option<String>
where
    F: Fn(&Path) -> bool,
{
    let cand = our_exe?.parent()?.join(exe_name);
    exists(&cand).then(|| cand.to_string_lossy().into_owned())
}

#[cfg(windows)]
fn from_registry(display_name: &str, exe_name: &str) -> Option<String> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};
    use winreg::RegKey;

    const UNINSTALL: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall";
    const WOW: &str = r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall";
    let hives: [(winreg::HKEY, &str); 3] = [
        (HKEY_CURRENT_USER, UNINSTALL),
        (HKEY_LOCAL_MACHINE, UNINSTALL),
        (HKEY_LOCAL_MACHINE, WOW),
    ];

    for (hive, path) in hives {
        let Ok(unin) = RegKey::predef(hive).open_subkey_with_flags(path, KEY_READ) else {
            continue;
        };
        for key in unin.enum_keys().flatten() {
            let Ok(sub) = unin.open_subkey_with_flags(&key, KEY_READ) else { continue };
            let dn: String = sub.get_value("DisplayName").unwrap_or_default();
            // O NSIS do Tauri grava o productName puro; outros empacotadores
            // acrescentam " 1.2.3". Aceitar os dois evita depender da versão.
            if dn != display_name && !dn.starts_with(&format!("{display_name} ")) {
                continue;
            }
            let loc: String = sub.get_value("InstallLocation").unwrap_or_default();
            let icon: String = sub.get_value("DisplayIcon").unwrap_or_default();
            if let Some(exe) =
                exe_from_registry_values(Some(&loc), Some(&icon), exe_name, |p| p.is_file())
            {
                return Some(exe);
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn from_registry(_display_name: &str, _exe_name: &str) -> Option<String> {
    None
}

/// AppImage em `~/Applications` (padrão do TaylorHub no Linux) ou binário no
/// PATH. No Linux o app costuma estar no PATH de verdade, então aqui vale.
#[cfg(not(windows))]
fn from_linux_locations(display_name: &str, exe_name: &str) -> Option<String> {
    if let Some(home) = std::env::var_os("HOME") {
        let dir = PathBuf::from(home).join("Applications");
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for e in rd.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                if name.starts_with(display_name) && name.ends_with(".AppImage") {
                    return Some(e.path().to_string_lossy().into_owned());
                }
            }
        }
    }
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|p| p.join(exe_name))
        .find(|p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
}

#[cfg(windows)]
fn from_linux_locations(_display_name: &str, _exe_name: &str) -> Option<String> {
    None
}

/// Caminho do LocalTerminal, ou `None` se não estiver instalado.
pub fn find_terminal() -> Option<String> {
    from_registry(TERMINAL_DISPLAY_NAME, TERMINAL_EXE)
        .or_else(|| from_linux_locations(TERMINAL_DISPLAY_NAME, TERMINAL_EXE))
        .or_else(|| {
            let ours = std::env::current_exe().ok();
            exe_beside_ours(ours.as_deref(), TERMINAL_EXE, |p| p.is_file())
        })
}

/// Sentinela que o front reconhece pra mostrar a mensagem traduzida de "não
/// instalado" em vez do texto cru — mesmo desenho do `SHORTCUT_BUSY` do
/// LocalTranslate/LocalTerminal.
pub const NOT_INSTALLED: &str = "TERMINAL_NOT_INSTALLED";

/// Abre o LocalTerminal na pasta pedida.
///
/// O `--cwd` é explícito de propósito: passar a pasta como argumento
/// posicional funcionaria, mas um caminho começando com `-` (existe) viraria
/// flag. Com `--cwd <path>` não há ambiguidade.
#[tauri::command(async)]
pub fn open_in_terminal(dir: String) -> Result<(), String> {
    // A pasta é conferida AQUI e não no terminal: se ela sumiu, quem sabe
    // disso é o gerenciador de arquivos, e o erro tem que aparecer na tela em
    // que o usuário está — não numa janela nova que abre no HOME.
    if !Path::new(&dir).is_dir() {
        return Err(format!("A pasta não existe mais: {dir}"));
    }
    let exe = find_terminal().ok_or(NOT_INSTALLED)?;
    let mut cmd = std::process::Command::new(&exe);
    cmd.arg("--cwd").arg(&dir);
    // Diretório de trabalho = pasta do exe (não a pasta alvo): é assim que o
    // TaylorHub lança os apps da suíte, e garante que o app ache seus
    // sidecars. Quem manda o cwd do shell é o `--cwd`.
    if let Some(p) = Path::new(&exe).parent() {
        cmd.current_dir(p);
    }
    cmd.spawn().map_err(|e| format!("Falha ao abrir o LocalTerminal: {e}"))?;
    Ok(())
}

/// O LocalTerminal está instalado? (a UI usa pra não oferecer o que não dá.)
#[tauri::command(async)]
pub fn terminal_available() -> bool {
    find_terminal().is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `exists` de mentira: só os caminhos listados "existem".
    fn only(paths: &[&str]) -> impl Fn(&Path) -> bool {
        let owned: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
        move |p: &Path| owned.iter().any(|x| x == p)
    }

    /// Caminho de teste montado com o separador DA PLATAFORMA.
    ///
    /// Os literais `r"C:\..."` da primeira versão destes testes passavam no
    /// Windows e quebravam no job Ubuntu do CI: no Linux `C:\a\b.exe` é UM
    /// componente só, então `join`/`parent` não fazem o que a asserção espera.
    /// A LÓGICA aqui (tirar aspas, cortar no `,`, juntar, subir um nível) é
    /// neutra de plataforma e merece rodar nas duas — o que era específico do
    /// Windows era só a forma de escrever o caminho. (Mesma família da lição
    /// "`#[cfg(windows)]` só o CI Linux pega".)
    fn p(parts: &[&str]) -> String {
        let mut b = PathBuf::new();
        for x in parts {
            b.push(x);
        }
        b.to_string_lossy().into_owned()
    }

    #[test]
    fn install_location_e_o_caminho_normal() {
        let loc = p(&["base", "LocalTerminal"]);
        let full = p(&["base", "LocalTerminal", "LocalTerminal.exe"]);
        let e = exe_from_registry_values(Some(&loc), None, "LocalTerminal.exe", only(&[&full]));
        assert_eq!(e.as_deref(), Some(full.as_str()));
    }

    #[test]
    fn sem_install_location_cai_no_display_icon() {
        let e = exe_from_registry_values(
            Some(""),
            Some(r"C:\Apps\LT\LocalTerminal.exe,0"),
            "LocalTerminal.exe",
            only(&[r"C:\Apps\LT\LocalTerminal.exe"]),
        );
        assert_eq!(e.as_deref(), Some(r"C:\Apps\LT\LocalTerminal.exe"));
    }

    #[test]
    fn display_icon_entre_aspas_e_sem_indice() {
        for icon in [r#""C:\Apps\LT\LocalTerminal.exe""#, r"C:\Apps\LT\LocalTerminal.exe"] {
            let e = exe_from_registry_values(
                None,
                Some(icon),
                "LocalTerminal.exe",
                only(&[r"C:\Apps\LT\LocalTerminal.exe"]),
            );
            assert_eq!(e.as_deref(), Some(r"C:\Apps\LT\LocalTerminal.exe"), "icon={icon}");
        }
    }

    #[test]
    fn install_location_obsoleto_nao_ganha_do_display_icon() {
        // O caso que morde de verdade: o usuário moveu/reinstalou e a chave
        // `InstallLocation` aponta pra uma pasta que não existe mais. Aceitar
        // o valor sem conferir daria "programa não encontrado" no spawn.
        let antigo = p(&["antigo", "LocalTerminal"]);
        let novo = p(&["novo", "LocalTerminal.exe"]);
        let e = exe_from_registry_values(
            Some(&antigo),
            Some(&format!("{novo},0")),
            "LocalTerminal.exe",
            only(&[&novo]),
        );
        assert_eq!(e.as_deref(), Some(novo.as_str()));
    }

    #[test]
    fn nada_encontrado_devolve_none() {
        assert_eq!(
            exe_from_registry_values(Some(r"C:\X"), Some(r"C:\Y\a.exe,0"), "a.exe", |_| false),
            None
        );
        assert_eq!(exe_from_registry_values(None, None, "a.exe", |_| true), None);
        assert_eq!(exe_from_registry_values(Some("  "), Some(""), "a.exe", |_| true), None);
    }

    #[test]
    fn display_icon_so_com_virgula_nao_vira_caminho_vazio() {
        assert_eq!(exe_from_registry_values(None, Some(",0"), "a.exe", |_| true), None);
    }

    /// O caso que estava QUEBRADO até a v0.6.2: vírgula DENTRO das aspas.
    ///
    /// Pasta com vírgula no nome é legal no Windows, e o NSIS da suíte grava o
    /// `DisplayIcon` entre aspas. Cortar na vírgula antes de aparar as aspas
    /// decepava o caminho e a detecção falhava calada — o usuário via só
    /// "LocalTerminal não encontrado". Quem termina o caminho é o fecha-aspas.
    #[test]
    fn virgula_dentro_das_aspas_e_parte_do_caminho() {
        let real = r"C:\Programas, Meus\LocalTerminal\LocalTerminal.exe";
        let icon = format!("\"{real}\"");
        assert_eq!(
            exe_from_registry_values(None, Some(&icon), "LocalTerminal.exe", only(&[real]))
                .as_deref(),
            Some(real),
            "a vírgula está dentro das aspas: é nome de pasta, não índice de ícone"
        );
    }

    /// E o outro formato (electron-builder, sem aspas) segue cortando no `,0`.
    #[test]
    fn sem_aspas_o_corte_na_virgula_continua_valendo() {
        let real = r"C:\Users\X\LocalMind\LocalMind.exe";
        let icon = format!("{real},0");
        assert_eq!(
            exe_from_registry_values(None, Some(&icon), "LocalMind.exe", only(&[real])).as_deref(),
            Some(real)
        );
    }

    // Só no Windows: aqui os literais COM barra invertida são o próprio objeto
    // do teste (é o texto que o registro do Windows guarda), então não dá pra
    // neutralizá-los sem perder o sentido.
    #[cfg(windows)]
    #[test]
    fn valores_reais_do_instalador_nsis_da_suite() {
        // Valores COPIADOS do registro desta máquina (2026-07-20). Duas coisas
        // que só apareceram olhando o dado real, e que um teste inventado não
        // teria: o `InstallLocation` vem ENTRE ASPAS, e o `DisplayIcon` vem
        // entre aspas e SEM o `,0`. O TaylorHub não tira as aspas do
        // InstallLocation — por isso ele acaba sempre caindo no DisplayIcon.
        let loc = r#""C:\Users\Hades\AppData\Local\LocalTerminal""#;
        let icon = r#""C:\Users\Hades\AppData\Local\LocalTerminal\localterminal.exe""#;
        let real = r"C:\Users\Hades\AppData\Local\LocalTerminal\LocalTerminal.exe";
        assert_eq!(
            exe_from_registry_values(Some(loc), Some(icon), "LocalTerminal.exe", only(&[real]))
                .as_deref(),
            Some(real),
            "aspas no InstallLocation têm que ser removidas"
        );
        // E se o InstallLocation não servir, o DisplayIcon entre aspas resolve.
        let lower = r"C:\Users\Hades\AppData\Local\LocalTerminal\localterminal.exe";
        assert_eq!(
            exe_from_registry_values(Some(loc), Some(icon), "LocalTerminal.exe", only(&[lower]))
                .as_deref(),
            Some(lower)
        );
    }

    #[test]
    fn find_terminal_nesta_maquina() {
        // Teste de AMBIENTE: não afirma que o LocalTerminal está instalado
        // (numa máquina limpa ou no runner do CI ele não está). O que ele
        // garante é que a varredura do registro não estoura e que, quando
        // acha, devolve um caminho que EXISTE — em vez de fingir que
        // exercitou o caso. (Lição do LocalFiles 0.5.1.)
        match find_terminal() {
            Some(p) => assert!(
                Path::new(&p).is_file(),
                "find_terminal devolveu um caminho que não existe: {p}"
            ),
            None => eprintln!(
                "[teste] LocalTerminal não instalado nesta máquina — o caminho de \
                 sucesso do find_terminal() NÃO foi exercitado aqui."
            ),
        }
    }

    #[test]
    fn vizinho_do_nosso_exe() {
        let ours = p(&["apps", "LocalFiles.exe"]);
        let neighbour = p(&["apps", "LocalTerminal.exe"]);
        let e = exe_beside_ours(
            Some(Path::new(&ours)),
            "LocalTerminal.exe",
            only(&[&neighbour]),
        );
        assert_eq!(e.as_deref(), Some(neighbour.as_str()));
        // Sem vizinho: None, não um caminho que não existe.
        assert_eq!(exe_beside_ours(Some(Path::new(&ours)), "X.exe", |_| false), None);
        assert_eq!(exe_beside_ours(None, "X.exe", |_| true), None);
    }

    #[test]
    fn pasta_inexistente_falha_antes_de_procurar_o_exe() {
        // A ordem importa: se procurássemos o exe primeiro, um usuário sem o
        // LocalTerminal instalado veria "instale o terminal" quando o problema
        // real é que a pasta sumiu.
        let e = open_in_terminal("C:\\pasta-que-nao-existe-98765".into()).unwrap_err();
        assert!(e.contains("não existe"), "{e}");
        assert!(!e.contains(NOT_INSTALLED), "{e}");
    }
}
