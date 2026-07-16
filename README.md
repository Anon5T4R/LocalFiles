# LocalFiles

Gerenciador de arquivos **100% offline** da suíte Local — o "shell" que faltava:
navegar, organizar, copiar e mover arquivos sem depender do Explorer.

## Recursos (v0.1)

- **Navegação com abas** (Ctrl+T/Ctrl+W) + breadcrumb clicável (Ctrl+L edita o caminho)
- **Três visões:** detalhes (colunas ordenáveis), lista e grade
- **Operações:** copiar/recortar/colar (Ctrl+C/X/V), renomear (F2), nova pasta,
  **excluir sempre pra lixeira** (Delete) — delete permanente nem existe
- **Copiar/mover com progresso e cancelamento** (colisão de nome ganha sufixo
  " (2)", nunca sobrescreve em silêncio)
- **Drag-and-drop:** interno (mover; Ctrl = copiar) e vindo do SO (copia pra pasta atual)
- **Menu de contexto** completo + propriedades (tamanho de pasta calculado)
- Sidebar com **locais conhecidos e unidades** (espaço livre)
- Tema claro/escuro/sistema · UI em **PT/EN/ES** · configurações persistidas

Abrir arquivo usa o **app padrão do SO** — as associações registradas pelo
TaylorHub são respeitadas. O LocalFiles **não rouba** nenhuma associação.

## Stack

Tauri 2 + React 19 + Vite + TypeScript no front; Rust no back
(`trash` pra lixeira, `sysinfo` pros volumes, motor próprio de cópia com
progresso/cancelamento). Sem sidecar, sem rede.

## Dev

```bash
npm install
npm run tauri dev   # porta 1458
```

Testes: `npm test` (front) e `cargo test` em `src-tauri/` (CI).

## Release

Tag `vX.Y.Z` → GitHub Actions builda NSIS (Windows) + AppImage (Linux) e
publica a Release. Parte da suíte [Local](https://github.com/Anon5T4R).

## Licença

MIT
