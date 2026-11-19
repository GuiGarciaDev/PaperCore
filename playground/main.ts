import {
  createBackground,
  createPaperCore,
  PaperCoreError,
  type BackgroundType,
  type ToolName,
} from "papercore";

const $ = <T extends HTMLElement>(selector: string) => {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Elemento não encontrado: ${selector}`);
  return el;
};

const engine = createPaperCore($("#surface"), { keyboardShortcuts: true });

// Exposto só no playground, para depurar pelo console do navegador.
(window as unknown as { paper: typeof engine }).paper = engine;

// ── Toast de erro ──────────────────────────────────────────────────────────
const toast = $<HTMLDivElement>("#toast");
let toastTimer: number | undefined;
function showError(error: unknown) {
  const message =
    error instanceof PaperCoreError
      ? [error.message, ...error.details.slice(0, 5)].join("\n")
      : error instanceof Error
        ? error.message
        : String(error);
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 5000);
}
const guard = (fn: () => void) => () => {
  try {
    fn();
  } catch (error) {
    showError(error);
  }
};
engine.on("error", showError);

// ── Ferramentas ────────────────────────────────────────────────────────────
document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((button) => {
  button.addEventListener(
    "click",
    guard(() => engine.setTool(button.dataset.tool as ToolName)),
  );
});
document.querySelectorAll<HTMLButtonElement>("[data-color]").forEach((button) => {
  button.addEventListener(
    "click",
    guard(() => engine.setPenStyle({ color: button.dataset.color! })),
  );
});
const widthInput = $<HTMLInputElement>("#width");
widthInput.addEventListener(
  "input",
  guard(() => engine.setPenStyle({ width: Number(widthInput.value) })),
);

$("#undo").addEventListener(
  "click",
  guard(() => engine.undo()),
);
$("#redo").addEventListener(
  "click",
  guard(() => engine.redo()),
);
$("#clear").addEventListener(
  "click",
  guard(() => {
    if (confirm("Limpar todos os traços desta página? (pode ser desfeito)")) engine.clearPage();
  }),
);

// ── Páginas e fundo ────────────────────────────────────────────────────────
const pageIds = () => engine.getDocument().pages.map((p) => p.id);
$("#prev").addEventListener(
  "click",
  guard(() => {
    const { activePageIndex } = engine.getState();
    if (activePageIndex > 0) engine.setActivePage(pageIds()[activePageIndex - 1]!);
  }),
);
$("#next").addEventListener(
  "click",
  guard(() => {
    const { activePageIndex } = engine.getState();
    const ids = pageIds();
    if (activePageIndex < ids.length - 1) engine.setActivePage(ids[activePageIndex + 1]!);
  }),
);
$("#add-page").addEventListener(
  "click",
  guard(() => engine.addPage()),
);
$("#duplicate-page").addEventListener(
  "click",
  guard(() => engine.duplicatePage()),
);
$("#delete-page").addEventListener(
  "click",
  guard(() => {
    if (confirm("Excluir esta página? Essa ação não pode ser desfeita.")) engine.deletePage();
  }),
);
const backgroundSelect = $<HTMLSelectElement>("#background");
backgroundSelect.addEventListener(
  "change",
  guard(() => engine.setPageBackground(createBackground(backgroundSelect.value as BackgroundType))),
);

// ── Zoom e leitura ─────────────────────────────────────────────────────────
$("#zoom-in").addEventListener(
  "click",
  guard(() => engine.zoomIn()),
);
$("#zoom-out").addEventListener(
  "click",
  guard(() => engine.zoomOut()),
);
$("#zoom-reset").addEventListener(
  "click",
  guard(() => engine.resetView()),
);
const readOnly = $<HTMLInputElement>("#readonly");
readOnly.addEventListener(
  "change",
  guard(() => engine.setReadOnly(readOnly.checked)),
);

// ── Importar / exportar ────────────────────────────────────────────────────
$("#export").addEventListener(
  "click",
  guard(() => {
    const blob = new Blob([engine.exportJSON()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement("a"), {
      href: url,
      download: `papercore-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`,
    });
    link.click();
    URL.revokeObjectURL(url);
  }),
);
const fileInput = $<HTMLInputElement>("#import-file");
$("#import").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (!file) return;
  try {
    engine.importJSON(await file.text());
  } catch (error) {
    showError(error);
  }
});

// ── Reflexo do estado na interface ─────────────────────────────────────────
function render() {
  const state = engine.getState();
  const doc = engine.getDocument();
  const page = doc.pages[state.activePageIndex]!;

  document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.tool === state.tool));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-color]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.color === state.pen.color));
  });
  widthInput.value = String(state.pen.width);
  $("#width-value").textContent = String(state.pen.width);
  ($("#undo") as HTMLButtonElement).disabled = !state.canUndo;
  ($("#redo") as HTMLButtonElement).disabled = !state.canRedo;
  ($("#prev") as HTMLButtonElement).disabled = state.activePageIndex === 0;
  ($("#next") as HTMLButtonElement).disabled = state.activePageIndex === state.pageCount - 1;
  ($("#delete-page") as HTMLButtonElement).disabled = state.pageCount <= 1 || state.readOnly;
  for (const id of ["#clear", "#add-page", "#duplicate-page"]) {
    ($(id) as HTMLButtonElement).disabled = state.readOnly;
  }
  backgroundSelect.disabled = state.readOnly;
  backgroundSelect.value = page.background.type;
  readOnly.checked = state.readOnly;
  $("#page-label").textContent = `${state.activePageIndex + 1} / ${state.pageCount}`;
  $("#zoom-reset").textContent = `${Math.round(state.zoom * 100)}%`;
}

/** Só quando o documento muda (serializar a cada zoom seria desperdício). */
function renderStats() {
  const page = engine.getDocument().pages[engine.getState().activePageIndex]!;
  const points = page.elements.reduce((sum, e) => sum + e.points.length / 3, 0);
  const kb = (engine.exportJSON().length / 1024).toFixed(1);
  $("#stats").textContent =
    `Traços na página: ${page.elements.length} · pontos: ${points} · documento: ${kb} KB`;
}

engine.on("state", () => {
  render();
  renderStats();
});
engine.on("change", (change) => {
  render();
  renderStats();
  $("#change-info").textContent =
    `Última alteração: ${change.reason}` +
    (change.changedPageIds.length ? ` · páginas alteradas: ${change.changedPageIds.length}` : "") +
    (change.deletedPageIds.length ? ` · excluídas: ${change.deletedPageIds.length}` : "");
});

let lastInputUpdate = 0;
engine.on("input", (sample) => {
  const now = performance.now();
  if (now - lastInputUpdate < 100) return;
  lastInputUpdate = now;
  const pressure = sample.hasPressure ? sample.pressure.toFixed(2) : "não informada";
  $("#input-info").textContent =
    `Ponteiro: ${sample.kind} · pressão: ${pressure}` +
    (engine.getState().penDetected ? " · caneta detectada (palma ignorada)" : "");
});

render();
renderStats();
