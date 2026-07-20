import { useSyncExternalStore } from "react";

/**
 * i18n leve da UI (padrão da suíte, ver docs/planos/padrao-apps.md). O dict
 * `pt` é a fonte da verdade das chaves; `en`/`es` como `Record<MessageKey,
 * string>` fazem o compilador recusar chave faltando ou sobrando. O locale
 * vive num store externo (não React) pra o `t()` poder ser chamado fora de
 * componente (toasts do store); o App remonta na troca (key={locale}).
 */

export type Locale = "pt" | "en" | "es";

export const LOCALE_LABELS: Record<Locale, string> = {
  pt: "Português",
  en: "English",
  es: "Español",
};

/** Tag pro Intl (datas no formato do idioma da UI). */
export const LOCALE_TAGS: Record<Locale, string> = {
  pt: "pt-BR",
  en: "en-US",
  es: "es",
};

const LOCALE_KEY = "localfiles.locale";

const pt = {
  // TopBar / navegação
  "nav.back": "Voltar",
  "nav.forward": "Avançar",
  "nav.up": "Pasta acima",
  "nav.refresh": "Atualizar",
  "nav.editPath": "Editar caminho (Ctrl+L)",
  "nav.go": "Ir",
  "view.details": "Detalhes",
  "view.list": "Lista",
  "view.grid": "Grade",
  "topbar.newFolder": "Nova pasta",
  "topbar.newFile": "Novo arquivo",
  "topbar.showHidden": "Mostrar itens ocultos",
  "topbar.settingsTitle": "Configurações",

  // Abas
  "tabs.newTab": "Nova aba (Ctrl+T)",
  "tabs.closeTab": "Fechar aba (Ctrl+W)",

  // Sidebar
  "side.places": "Locais",
  "side.drives": "Unidades",
  "side.home": "Início",
  "side.desktop": "Área de Trabalho",
  "side.documents": "Documentos",
  "side.downloads": "Downloads",
  "side.pictures": "Imagens",
  "side.music": "Músicas",
  "side.videos": "Vídeos",
  "side.freeOf": "{free} livres de {total}",

  // Colunas / lista
  "col.name": "Nome",
  "col.modified": "Modificado em",
  "col.type": "Tipo",
  "col.size": "Tamanho",
  "list.empty": "Pasta vazia",
  "list.loading": "Carregando…",
  "list.denied": "Não deu pra ler esta pasta: {error}",

  // Tipos (coluna Tipo)
  "kind.folder": "Pasta",
  "kind.image": "Imagem",
  "kind.video": "Vídeo",
  "kind.audio": "Áudio",
  "kind.document": "Documento",
  "kind.sheet": "Planilha",
  "kind.slides": "Apresentação",
  "kind.pdf": "PDF",
  "kind.archive": "Arquivo compactado",
  "kind.code": "Código",
  "kind.exe": "Programa",
  "kind.file": "Arquivo",

  // Menu de contexto
  "menu.open": "Abrir",
  "menu.openWith": "Abrir com…",
  "menu.openNewTab": "Abrir em nova aba",
  "menu.cut": "Recortar",
  "menu.copy": "Copiar",
  "menu.paste": "Colar",
  "menu.rename": "Renomear",
  "menu.delete": "Excluir",
  "menu.copyPath": "Copiar caminho",
  "menu.newFolder": "Nova pasta",
  "menu.newFile": "Novo arquivo",
  "menu.refresh": "Atualizar",
  "menu.properties": "Propriedades",
  "menu.selectAll": "Selecionar tudo",

  // Diálogos
  "dlg.newFolderTitle": "Nova pasta",
  "dlg.newFolderName": "Nome da pasta",
  "dlg.defaultFolderName": "Nova pasta",
  "dlg.newFileTitle": "Novo arquivo",
  "dlg.newFileName": "Nome do arquivo",
  "dlg.defaultFileName": "Novo arquivo.txt",
  "dlg.renameTitle": "Renomear",
  "dlg.renameLabel": "Novo nome",
  "dlg.deleteTitle": "Excluir",
  "dlg.deleteOne": "Enviar “{name}” para a lixeira?",
  "dlg.deleteMany": "Enviar {n} itens para a lixeira?",
  "dlg.deleteNote": "Dá pra restaurar pela lixeira do sistema.",
  "dlg.cancel": "Cancelar",
  "dlg.confirm": "OK",
  "dlg.create": "Criar",
  "dlg.deleteAction": "Excluir",

  // Propriedades
  "props.title": "Propriedades",
  "props.location": "Local",
  "props.type": "Tipo",
  "props.size": "Tamanho",
  "props.contains": "Contém",
  "props.contents": "{files} arquivos, {folders} pastas",
  "props.truncated": "(parcial — pasta muito grande)",
  "props.modified": "Modificado em",
  "props.attributes": "Atributos",
  "props.readonly": "somente leitura",
  "props.hidden": "oculto",
  "props.none": "—",
  "props.calculating": "calculando…",

  // Operações
  "ops.copying": "Copiando… {done} de {total}",
  "ops.moving": "Movendo… {done} de {total}",
  "ops.files": "{done}/{total} arquivos",
  "ops.cancel": "Cancelar",
  "ops.canceled": "Operação cancelada",
  "ops.copyDone": "Cópia concluída",
  "ops.moveDone": "Itens movidos",

  // Status bar
  "status.items": "{n} itens",
  "status.item": "1 item",
  "status.selected": "{n} selecionados ({size})",
  "status.selectedOne": "1 selecionado ({size})",
  "status.free": "{free} livres",

  // Toasts
  "toast.created": "Pasta “{name}” criada",
  "toast.renamed": "Renomeado para “{name}”",
  "toast.deleted": "{n} item(ns) enviados pra lixeira",
  "toast.deleteFailed": "Falha ao excluir: {error}",
  "toast.renameFailed": "Falha ao renomear: {error}",
  "toast.createFailed": "Falha ao criar a pasta: {error}",
  "toast.opFailed": "Falha na operação: {error}",
  "toast.openFailed": "Não consegui abrir: {error}",
  "toast.pathCopied": "Caminho copiado",
  "toast.copyFailed": "Não consegui copiar",
  "toast.nothingToPaste": "Nada pra colar",
  "toast.invalidPath": "Caminho não encontrado: {path}",

  // Busca (v0.2)
  "search.placeholder": "Buscar nesta pasta…  (Ctrl+F)",
  "search.inContent": "conteúdo",
  "search.inContentTitle": "Buscar também dentro dos arquivos (texto)",
  "search.results": "Resultados de “{q}”",
  "search.running": "buscando…",
  "search.count": "{n} resultados",
  "search.truncated": "(parcial — parei em {max})",
  "search.close": "Fechar a busca",
  "search.none": "Nada encontrado.",
  "col.folder": "Pasta",

  // Preview (v0.2)
  "preview.toggle": "Painel de visualização (Alt+P)",
  "preview.truncated": "— mostrando só o começo —",
  "preview.unavailable": "Sem visualização pra este tipo de arquivo.",
  "preview.select": "Selecione um arquivo pra visualizar.",
  "preview.inArchive": "Sem prévia aqui dentro — copie o item pra uma pasta primeiro.",

  // Renomear em lote (v0.2)
  "batch.title": "Renomear em lote",
  "batch.modeReplace": "Localizar e substituir",
  "batch.modePattern": "Padrão com contador",
  "batch.find": "Localizar",
  "batch.replace": "Substituir por",
  "batch.regex": "Expressão regular",
  "batch.pattern": "Padrão — {nome} = nome atual, {n} = contador",
  "batch.start": "Contador começa em",
  "batch.preview": "Prévia",
  "batch.conflictBadge": "conflito",
  "batch.conflicts": "{n} conflito(s) — resolva antes de aplicar",
  "batch.nothing": "Nada muda com essas opções.",
  "batch.apply": "Renomear {n} itens",
  "batch.done": "{n} item(ns) renomeados",
  "batch.someFailed": "{n} falharam (ex.: {error})",
  "menu.batchRename": "Renomear em lote…",

  // Favoritos (v0.2)
  "side.favorites": "Favoritos",
  "menu.addFavorite": "Adicionar aos favoritos",
  "menu.removeFavorite": "Remover dos favoritos",
  "topbar.favTitle": "Favoritar esta pasta",
  "fav.added": "“{name}” adicionado aos favoritos",
  "fav.removed": "Favorito removido",


  // Painel duplo (v0.5)
  "pane.toggleTitle": "Painel duplo (Ctrl+Shift+D)",
  "pane.copyTitle": "Copiar pro outro painel (Ctrl+Shift+C)",
  "pane.moveTitle": "Mover pro outro painel (Ctrl+Shift+M)",
  "pane.copyHere": "Copiar pro outro painel",
  "pane.moveHere": "Mover pro outro painel",
  "pane.focused": "Painel com foco (Tab alterna)",
  "pane.unfocused": "Clique ou Tab pra focar este painel",
  "pane.nothingSelected": "Selecione algo antes",
  "pane.samePlace": "Os dois painéis estão no mesmo lugar",

  // Zip inline (v0.5)
  "arch.badge": "dentro do arquivo",
  "arch.root": "Raiz do arquivo compactado",
  "menu.enterArchive": "Abrir aqui (como pasta)",
  "menu.openArchiveApp": "Abrir no app de compactação",
  "arch.extractFirst": "Pra abrir, primeiro copie o item pra uma pasta.",
  "arch.readOnly": "Só dá pra adicionar em .zip (e não em arquivo dividido).",
  "arch.noZipToZip": "Não dá pra transferir direto de um arquivo compactado pra outro.",
  "arch.mixedSources": "Escolha itens de um lugar só (ou do disco, ou de um arquivo).",
  "arch.moveOutIsCopy": "Tirar de dentro do arquivo COPIA — o item continua lá dentro.",
  "arch.moveInIsCopy": "Colar dentro do arquivo COPIA — o original fica onde está.",
  "arch.noDelete": "Excluir de dentro de um arquivo compactado é no app de compactação.",
  "arch.noRename": "Renomear dentro de um arquivo compactado é no app de compactação.",
  "arch.noSearch": "A busca não entra em arquivos compactados.",
  "arch.needDualToExtract": "Ligue o painel duplo e abra a pasta destino no outro lado.",
  "ops.extractDone": "Itens extraídos",
  "ops.addDone": "Itens adicionados ao arquivo",
  "ops.extracting": "Extraindo… {done} de {total}",
  "ops.adding": "Adicionando… {done} de {total}",
  "ops.symlinksKept": "{n} link(s) não foram movidos — a origem foi preservada",

  // Etiquetas (v0.5)
  "side.tags": "Etiquetas",
  "menu.tags": "Etiquetas…",
  "tag.title": "Etiquetas",
  "tag.forOne": "Etiquetas deste item.",
  "tag.forMany": "Etiquetas dos {n} itens selecionados.",
  "tag.none": "Nenhuma etiqueta ainda — crie a primeira abaixo.",
  "tag.new": "Nova etiqueta",
  "tag.add": "Adicionar",
  "tag.partial": "(só em alguns)",
  "tag.filtering": "Mostrando só “{tag}”",
  "tag.clearFilter": "Limpar o filtro de etiqueta (Esc)",
  "tag.filterTitle": "Mostrar só o que tem a etiqueta “{tag}”",
  "tag.noneHere": "Nada com essa etiqueta nesta pasta.",

  // Settings
  "settings.title": "Configurações",
  "settings.theme": "Tema",
  "settings.themeSystem": "Sistema",
  "settings.themeLight": "Claro",
  "settings.themeDark": "Escuro",
  "settings.themeNature": "Natureza",
  "settings.themeDarkBlue": "Azul escuro",
  "settings.themeCalmGreen": "Verde calmo",
  "settings.themePastelPink": "Rosa pastel",
  "settings.themePunkPrincess": "PunkPrincess",
  "settings.language": "Idioma",
  "settings.behavior": "Comportamento",
  "settings.showHidden": "Mostrar arquivos e pastas ocultos",
  "settings.about":
    " — gerenciador de arquivos 100% offline. Navegue, organize, copie e mova; excluir vai sempre pra lixeira. Parte da suíte Local.",
} as const;

export type MessageKey = keyof typeof pt;

const en: Record<MessageKey, string> = {
  "nav.back": "Back",
  "nav.forward": "Forward",
  "nav.up": "Up one folder",
  "nav.refresh": "Refresh",
  "nav.editPath": "Edit path (Ctrl+L)",
  "nav.go": "Go",
  "view.details": "Details",
  "view.list": "List",
  "view.grid": "Grid",
  "topbar.newFolder": "New folder",
  "topbar.newFile": "New file",
  "topbar.showHidden": "Show hidden items",
  "topbar.settingsTitle": "Settings",

  "tabs.newTab": "New tab (Ctrl+T)",
  "tabs.closeTab": "Close tab (Ctrl+W)",

  "side.places": "Places",
  "side.drives": "Drives",
  "side.home": "Home",
  "side.desktop": "Desktop",
  "side.documents": "Documents",
  "side.downloads": "Downloads",
  "side.pictures": "Pictures",
  "side.music": "Music",
  "side.videos": "Videos",
  "side.freeOf": "{free} free of {total}",

  "col.name": "Name",
  "col.modified": "Modified",
  "col.type": "Type",
  "col.size": "Size",
  "list.empty": "Empty folder",
  "list.loading": "Loading…",
  "list.denied": "Couldn't read this folder: {error}",

  "kind.folder": "Folder",
  "kind.image": "Image",
  "kind.video": "Video",
  "kind.audio": "Audio",
  "kind.document": "Document",
  "kind.sheet": "Spreadsheet",
  "kind.slides": "Presentation",
  "kind.pdf": "PDF",
  "kind.archive": "Archive",
  "kind.code": "Code",
  "kind.exe": "Program",
  "kind.file": "File",

  "menu.open": "Open",
  "menu.openWith": "Open with…",
  "menu.openNewTab": "Open in new tab",
  "menu.cut": "Cut",
  "menu.copy": "Copy",
  "menu.paste": "Paste",
  "menu.rename": "Rename",
  "menu.delete": "Delete",
  "menu.copyPath": "Copy path",
  "menu.newFolder": "New folder",
  "menu.newFile": "New file",
  "menu.refresh": "Refresh",
  "menu.properties": "Properties",
  "menu.selectAll": "Select all",

  "dlg.newFolderTitle": "New folder",
  "dlg.newFolderName": "Folder name",
  "dlg.defaultFolderName": "New folder",
  "dlg.newFileTitle": "New file",
  "dlg.newFileName": "File name",
  "dlg.defaultFileName": "New file.txt",
  "dlg.renameTitle": "Rename",
  "dlg.renameLabel": "New name",
  "dlg.deleteTitle": "Delete",
  "dlg.deleteOne": "Send “{name}” to the trash?",
  "dlg.deleteMany": "Send {n} items to the trash?",
  "dlg.deleteNote": "You can restore them from the system trash.",
  "dlg.cancel": "Cancel",
  "dlg.confirm": "OK",
  "dlg.create": "Create",
  "dlg.deleteAction": "Delete",

  "props.title": "Properties",
  "props.location": "Location",
  "props.type": "Type",
  "props.size": "Size",
  "props.contains": "Contains",
  "props.contents": "{files} files, {folders} folders",
  "props.truncated": "(partial — folder too large)",
  "props.modified": "Modified",
  "props.attributes": "Attributes",
  "props.readonly": "read-only",
  "props.hidden": "hidden",
  "props.none": "—",
  "props.calculating": "calculating…",

  "ops.copying": "Copying… {done} of {total}",
  "ops.moving": "Moving… {done} of {total}",
  "ops.files": "{done}/{total} files",
  "ops.cancel": "Cancel",
  "ops.canceled": "Operation canceled",
  "ops.copyDone": "Copy finished",
  "ops.moveDone": "Items moved",

  "status.items": "{n} items",
  "status.item": "1 item",
  "status.selected": "{n} selected ({size})",
  "status.selectedOne": "1 selected ({size})",
  "status.free": "{free} free",

  "toast.created": "Folder “{name}” created",
  "toast.renamed": "Renamed to “{name}”",
  "toast.deleted": "{n} item(s) sent to the trash",
  "toast.deleteFailed": "Failed to delete: {error}",
  "toast.renameFailed": "Failed to rename: {error}",
  "toast.createFailed": "Failed to create the folder: {error}",
  "toast.opFailed": "Operation failed: {error}",
  "toast.openFailed": "Couldn't open: {error}",
  "toast.pathCopied": "Path copied",
  "toast.copyFailed": "Couldn't copy",
  "toast.nothingToPaste": "Nothing to paste",
  "toast.invalidPath": "Path not found: {path}",

  "search.placeholder": "Search this folder…  (Ctrl+F)",
  "search.inContent": "content",
  "search.inContentTitle": "Also search inside files (text)",
  "search.results": "Results for “{q}”",
  "search.running": "searching…",
  "search.count": "{n} results",
  "search.truncated": "(partial — stopped at {max})",
  "search.close": "Close search",
  "search.none": "Nothing found.",
  "col.folder": "Folder",

  "preview.toggle": "Preview panel (Alt+P)",
  "preview.truncated": "— showing the beginning only —",
  "preview.unavailable": "No preview for this file type.",
  "preview.select": "Select a file to preview.",
  "preview.inArchive": "No preview in here — copy the item to a folder first.",

  "batch.title": "Batch rename",
  "batch.modeReplace": "Find and replace",
  "batch.modePattern": "Pattern with counter",
  "batch.find": "Find",
  "batch.replace": "Replace with",
  "batch.regex": "Regular expression",
  "batch.pattern": "Pattern — {nome} = current name, {n} = counter",
  "batch.start": "Counter starts at",
  "batch.preview": "Preview",
  "batch.conflictBadge": "conflict",
  "batch.conflicts": "{n} conflict(s) — resolve them before applying",
  "batch.nothing": "Nothing changes with these options.",
  "batch.apply": "Rename {n} items",
  "batch.done": "{n} item(s) renamed",
  "batch.someFailed": "{n} failed (e.g.: {error})",
  "menu.batchRename": "Batch rename…",

  "side.favorites": "Favorites",
  "menu.addFavorite": "Add to favorites",
  "menu.removeFavorite": "Remove from favorites",
  "topbar.favTitle": "Favorite this folder",
  "fav.added": "“{name}” added to favorites",
  "fav.removed": "Favorite removed",


  "pane.toggleTitle": "Dual pane (Ctrl+Shift+D)",
  "pane.copyTitle": "Copy to the other pane (Ctrl+Shift+C)",
  "pane.moveTitle": "Move to the other pane (Ctrl+Shift+M)",
  "pane.copyHere": "Copy to the other pane",
  "pane.moveHere": "Move to the other pane",
  "pane.focused": "Focused pane (Tab switches)",
  "pane.unfocused": "Click or press Tab to focus this pane",
  "pane.nothingSelected": "Select something first",
  "pane.samePlace": "Both panes are in the same place",

  "arch.badge": "inside archive",
  "arch.root": "Archive root",
  "menu.enterArchive": "Open here (as a folder)",
  "menu.openArchiveApp": "Open in the archiver app",
  "arch.extractFirst": "To open it, copy the item to a folder first.",
  "arch.readOnly": "Adding only works in .zip (and not in a split archive).",
  "arch.noZipToZip": "Cannot transfer straight from one archive to another.",
  "arch.mixedSources": "Pick items from one place only (either disk or one archive).",
  "arch.moveOutIsCopy": "Taking items out COPIES them — they stay inside the archive.",
  "arch.moveInIsCopy": "Pasting into the archive COPIES — the original stays put.",
  "arch.noDelete": "Deleting from inside an archive belongs in the archiver app.",
  "arch.noRename": "Renaming inside an archive belongs in the archiver app.",
  "arch.noSearch": "Search does not go inside archives.",
  "arch.needDualToExtract": "Turn on dual pane and open the target folder on the other side.",
  "ops.extractDone": "Items extracted",
  "ops.addDone": "Items added to the archive",
  "ops.extracting": "Extracting… {done} of {total}",
  "ops.adding": "Adding… {done} of {total}",
  "ops.symlinksKept": "{n} link(s) were not moved — the source was preserved",

  "side.tags": "Tags",
  "menu.tags": "Tags…",
  "tag.title": "Tags",
  "tag.forOne": "Tags for this item.",
  "tag.forMany": "Tags for the {n} selected items.",
  "tag.none": "No tags yet — create the first one below.",
  "tag.new": "New tag",
  "tag.add": "Add",
  "tag.partial": "(only on some)",
  "tag.filtering": "Showing only “{tag}”",
  "tag.clearFilter": "Clear the tag filter (Esc)",
  "tag.filterTitle": "Show only items tagged “{tag}”",
  "tag.noneHere": "Nothing with that tag in this folder.",

  "settings.title": "Settings",
  "settings.theme": "Theme",
  "settings.themeSystem": "System",
  "settings.themeLight": "Light",
  "settings.themeDark": "Dark",
  "settings.themeNature": "Nature",
  "settings.themeDarkBlue": "Dark blue",
  "settings.themeCalmGreen": "Calm green",
  "settings.themePastelPink": "Pastel pink",
  "settings.themePunkPrincess": "PunkPrincess",
  "settings.language": "Language",
  "settings.behavior": "Behavior",
  "settings.showHidden": "Show hidden files and folders",
  "settings.about":
    " — 100% offline file manager. Browse, organize, copy and move; delete always goes to the trash. Part of the Local suite.",
};

const es: Record<MessageKey, string> = {
  "nav.back": "Atrás",
  "nav.forward": "Adelante",
  "nav.up": "Carpeta superior",
  "nav.refresh": "Actualizar",
  "nav.editPath": "Editar ruta (Ctrl+L)",
  "nav.go": "Ir",
  "view.details": "Detalles",
  "view.list": "Lista",
  "view.grid": "Cuadrícula",
  "topbar.newFolder": "Nueva carpeta",
  "topbar.newFile": "Nuevo archivo",
  "topbar.showHidden": "Mostrar elementos ocultos",
  "topbar.settingsTitle": "Configuración",

  "tabs.newTab": "Nueva pestaña (Ctrl+T)",
  "tabs.closeTab": "Cerrar pestaña (Ctrl+W)",

  "side.places": "Lugares",
  "side.drives": "Unidades",
  "side.home": "Inicio",
  "side.desktop": "Escritorio",
  "side.documents": "Documentos",
  "side.downloads": "Descargas",
  "side.pictures": "Imágenes",
  "side.music": "Música",
  "side.videos": "Vídeos",
  "side.freeOf": "{free} libres de {total}",

  "col.name": "Nombre",
  "col.modified": "Modificado",
  "col.type": "Tipo",
  "col.size": "Tamaño",
  "list.empty": "Carpeta vacía",
  "list.loading": "Cargando…",
  "list.denied": "No se pudo leer esta carpeta: {error}",

  "kind.folder": "Carpeta",
  "kind.image": "Imagen",
  "kind.video": "Vídeo",
  "kind.audio": "Audio",
  "kind.document": "Documento",
  "kind.sheet": "Hoja de cálculo",
  "kind.slides": "Presentación",
  "kind.pdf": "PDF",
  "kind.archive": "Archivo comprimido",
  "kind.code": "Código",
  "kind.exe": "Programa",
  "kind.file": "Archivo",

  "menu.open": "Abrir",
  "menu.openWith": "Abrir con…",
  "menu.openNewTab": "Abrir en nueva pestaña",
  "menu.cut": "Cortar",
  "menu.copy": "Copiar",
  "menu.paste": "Pegar",
  "menu.rename": "Renombrar",
  "menu.delete": "Eliminar",
  "menu.copyPath": "Copiar ruta",
  "menu.newFolder": "Nueva carpeta",
  "menu.newFile": "Nuevo archivo",
  "menu.refresh": "Actualizar",
  "menu.properties": "Propiedades",
  "menu.selectAll": "Seleccionar todo",

  "dlg.newFolderTitle": "Nueva carpeta",
  "dlg.newFolderName": "Nombre de la carpeta",
  "dlg.defaultFolderName": "Nueva carpeta",
  "dlg.newFileTitle": "Nuevo archivo",
  "dlg.newFileName": "Nombre del archivo",
  "dlg.defaultFileName": "Nuevo archivo.txt",
  "dlg.renameTitle": "Renombrar",
  "dlg.renameLabel": "Nuevo nombre",
  "dlg.deleteTitle": "Eliminar",
  "dlg.deleteOne": "¿Enviar “{name}” a la papelera?",
  "dlg.deleteMany": "¿Enviar {n} elementos a la papelera?",
  "dlg.deleteNote": "Puedes restaurarlos desde la papelera del sistema.",
  "dlg.cancel": "Cancelar",
  "dlg.confirm": "OK",
  "dlg.create": "Crear",
  "dlg.deleteAction": "Eliminar",

  "props.title": "Propiedades",
  "props.location": "Ubicación",
  "props.type": "Tipo",
  "props.size": "Tamaño",
  "props.contains": "Contiene",
  "props.contents": "{files} archivos, {folders} carpetas",
  "props.truncated": "(parcial — carpeta demasiado grande)",
  "props.modified": "Modificado",
  "props.attributes": "Atributos",
  "props.readonly": "solo lectura",
  "props.hidden": "oculto",
  "props.none": "—",
  "props.calculating": "calculando…",

  "ops.copying": "Copiando… {done} de {total}",
  "ops.moving": "Moviendo… {done} de {total}",
  "ops.files": "{done}/{total} archivos",
  "ops.cancel": "Cancelar",
  "ops.canceled": "Operación cancelada",
  "ops.copyDone": "Copia terminada",
  "ops.moveDone": "Elementos movidos",

  "status.items": "{n} elementos",
  "status.item": "1 elemento",
  "status.selected": "{n} seleccionados ({size})",
  "status.selectedOne": "1 seleccionado ({size})",
  "status.free": "{free} libres",

  "toast.created": "Carpeta “{name}” creada",
  "toast.renamed": "Renombrado a “{name}”",
  "toast.deleted": "{n} elemento(s) enviados a la papelera",
  "toast.deleteFailed": "Error al eliminar: {error}",
  "toast.renameFailed": "Error al renombrar: {error}",
  "toast.createFailed": "Error al crear la carpeta: {error}",
  "toast.opFailed": "Error en la operación: {error}",
  "toast.openFailed": "No se pudo abrir: {error}",
  "toast.pathCopied": "Ruta copiada",
  "toast.copyFailed": "No se pudo copiar",
  "toast.nothingToPaste": "Nada que pegar",
  "toast.invalidPath": "Ruta no encontrada: {path}",

  "search.placeholder": "Buscar en esta carpeta…  (Ctrl+F)",
  "search.inContent": "contenido",
  "search.inContentTitle": "Buscar también dentro de los archivos (texto)",
  "search.results": "Resultados de “{q}”",
  "search.running": "buscando…",
  "search.count": "{n} resultados",
  "search.truncated": "(parcial — me detuve en {max})",
  "search.close": "Cerrar la búsqueda",
  "search.none": "No se encontró nada.",
  "col.folder": "Carpeta",

  "preview.toggle": "Panel de vista previa (Alt+P)",
  "preview.truncated": "— mostrando solo el comienzo —",
  "preview.unavailable": "Sin vista previa para este tipo de archivo.",
  "preview.select": "Selecciona un archivo para previsualizar.",
  "preview.inArchive": "Sin vista previa aquí dentro — copia primero el elemento a una carpeta.",

  "batch.title": "Renombrar en lote",
  "batch.modeReplace": "Buscar y reemplazar",
  "batch.modePattern": "Patrón con contador",
  "batch.find": "Buscar",
  "batch.replace": "Reemplazar con",
  "batch.regex": "Expresión regular",
  "batch.pattern": "Patrón — {nome} = nombre actual, {n} = contador",
  "batch.start": "El contador empieza en",
  "batch.preview": "Vista previa",
  "batch.conflictBadge": "conflicto",
  "batch.conflicts": "{n} conflicto(s) — resuélvelos antes de aplicar",
  "batch.nothing": "Nada cambia con estas opciones.",
  "batch.apply": "Renombrar {n} elementos",
  "batch.done": "{n} elemento(s) renombrados",
  "batch.someFailed": "{n} fallaron (p. ej.: {error})",
  "menu.batchRename": "Renombrar en lote…",

  "side.favorites": "Favoritos",
  "menu.addFavorite": "Añadir a favoritos",
  "menu.removeFavorite": "Quitar de favoritos",
  "topbar.favTitle": "Marcar esta carpeta como favorita",
  "fav.added": "“{name}” añadido a favoritos",
  "fav.removed": "Favorito eliminado",


  "pane.toggleTitle": "Panel doble (Ctrl+Shift+D)",
  "pane.copyTitle": "Copiar al otro panel (Ctrl+Shift+C)",
  "pane.moveTitle": "Mover al otro panel (Ctrl+Shift+M)",
  "pane.copyHere": "Copiar al otro panel",
  "pane.moveHere": "Mover al otro panel",
  "pane.focused": "Panel enfocado (Tab alterna)",
  "pane.unfocused": "Haz clic o pulsa Tab para enfocar este panel",
  "pane.nothingSelected": "Selecciona algo primero",
  "pane.samePlace": "Los dos paneles están en el mismo lugar",

  "arch.badge": "dentro del archivo",
  "arch.root": "Raíz del archivo comprimido",
  "menu.enterArchive": "Abrir aquí (como carpeta)",
  "menu.openArchiveApp": "Abrir en la app de compresión",
  "arch.extractFirst": "Para abrirlo, copia primero el elemento a una carpeta.",
  "arch.readOnly": "Solo se puede añadir en .zip (y no en un archivo dividido).",
  "arch.noZipToZip": "No se puede transferir directamente de un archivo a otro.",
  "arch.mixedSources": "Elige elementos de un solo lugar (del disco o de un archivo).",
  "arch.moveOutIsCopy": "Sacar del archivo COPIA — el elemento sigue dentro.",
  "arch.moveInIsCopy": "Pegar dentro del archivo COPIA — el original se queda donde está.",
  "arch.noDelete": "Eliminar dentro de un archivo comprimido es cosa de la app de compresión.",
  "arch.noRename": "Renombrar dentro de un archivo comprimido es cosa de la app de compresión.",
  "arch.noSearch": "La búsqueda no entra en archivos comprimidos.",
  "arch.needDualToExtract": "Activa el panel doble y abre la carpeta destino en el otro lado.",
  "ops.extractDone": "Elementos extraídos",
  "ops.addDone": "Elementos añadidos al archivo",
  "ops.extracting": "Extrayendo… {done} de {total}",
  "ops.adding": "Añadiendo… {done} de {total}",
  "ops.symlinksKept": "{n} enlace(s) no se movieron — el origen se conservó",

  "side.tags": "Etiquetas",
  "menu.tags": "Etiquetas…",
  "tag.title": "Etiquetas",
  "tag.forOne": "Etiquetas de este elemento.",
  "tag.forMany": "Etiquetas de los {n} elementos seleccionados.",
  "tag.none": "Aún no hay etiquetas — crea la primera abajo.",
  "tag.new": "Nueva etiqueta",
  "tag.add": "Añadir",
  "tag.partial": "(solo en algunos)",
  "tag.filtering": "Mostrando solo “{tag}”",
  "tag.clearFilter": "Quitar el filtro de etiqueta (Esc)",
  "tag.filterTitle": "Mostrar solo lo que tiene la etiqueta “{tag}”",
  "tag.noneHere": "Nada con esa etiqueta en esta carpeta.",

  "settings.title": "Configuración",
  "settings.theme": "Tema",
  "settings.themeSystem": "Sistema",
  "settings.themeLight": "Claro",
  "settings.themeDark": "Oscuro",
  "settings.themeNature": "Naturaleza",
  "settings.themeDarkBlue": "Azul oscuro",
  "settings.themeCalmGreen": "Verde tranquilo",
  "settings.themePastelPink": "Rosa pastel",
  "settings.themePunkPrincess": "PunkPrincess",
  "settings.language": "Idioma",
  "settings.behavior": "Comportamiento",
  "settings.showHidden": "Mostrar archivos y carpetas ocultos",
  "settings.about":
    " — gestor de archivos 100% offline. Navega, organiza, copia y mueve; eliminar siempre va a la papelera. Parte de la suite Local.",
};

const DICTS: Record<Locale, Record<MessageKey, string>> = { pt, en, es };

/** Palpite de locale pelo idioma do sistema (só no 1º uso). */
export function detectLocale(): Locale {
  const l = (typeof navigator !== "undefined" ? navigator.language : "pt").toLowerCase();
  if (l.startsWith("en")) return "en";
  if (l.startsWith("es")) return "es";
  return "pt";
}

function loadLocale(): Locale {
  const v = typeof localStorage !== "undefined" ? localStorage.getItem(LOCALE_KEY) : null;
  return v === "pt" || v === "en" || v === "es" ? v : detectLocale();
}

let current: Locale = loadLocale();
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return current;
}

/** Tag Intl do locale atual (datas/números). */
export function localeTag(): string {
  return LOCALE_TAGS[current];
}

export function setLocale(locale: Locale) {
  if (locale === current) return;
  current = locale;
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    /* localStorage indisponível */
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Inscreve o componente nas trocas de locale. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale);
}

/** Traduz uma chave, interpolando placeholders `{param}`. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  let msg: string = DICTS[current][key] ?? pt[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      msg = msg.split(`{${k}}`).join(String(v));
    }
  }
  return msg;
}
