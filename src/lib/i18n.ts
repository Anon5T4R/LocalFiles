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
