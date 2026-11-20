import {
  createBackground,
  createPaperCore,
  PaperCoreError,
  type BackgroundType,
  type ToolName,
} from "papercore";
import { createAutosave, IndexedDbStorageAdapter, type AutosaveState } from "papercore/storage";

const $ = <T extends HTMLElement>(selector: string) => {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);
  return el;
};

// ── Local persistence (IndexedDB) ──────────────────────────────────────────
// The playground keeps a single document: the last saved one is reopened on reload.
const storage = new IndexedDbStorageAdapter({ databaseName: "papercore-playground" });
let startupError: unknown = null;
async function loadLastDocument() {
  try {
    const [lastId] = await storage.list();
    return lastId ? await storage.load(lastId) : null;
  } catch (error) {
    startupError = error;
    return null;
  }
}
const savedDocument = await loadLastDocument();

const engine = createPaperCore($("#surface"), {
  keyboardShortcuts: true,
  document: savedDocument ?? undefined,
});
const autosave = createAutosave(engine, storage);

/** Writes the whole current document and removes older ones (the playground keeps only one). */
async function persistCurrentDocument() {
  await autosave.saveAll();
  const currentId = engine.getDocument().id;
  for (const id of await storage.list()) if (id !== currentId) await storage.deleteDocument(id);
}

// Exposed only in the playground, to debug from the browser console.
(window as unknown as { paper: typeof engine }).paper = engine;

// ── Error toast ────────────────────────────────────────────────────────────
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
// ── Confirmation (replaces the native confirm(), which may be blocked) ─────
const confirmDialog = $<HTMLDialogElement>("#confirm-dialog");
function askConfirm(message: string, confirmLabel: string): Promise<boolean> {
  $("#confirm-message").textContent = message;
  $("#confirm-ok").textContent = confirmLabel;
  confirmDialog.returnValue = "";
  confirmDialog.showModal();
  return new Promise((resolve) => {
    // "close" fires when a button is clicked and also on Esc (empty returnValue = cancelled).
    confirmDialog.addEventListener("close", () => resolve(confirmDialog.returnValue === "ok"), {
      once: true,
    });
  });
}

const guard = (fn: () => void) => () => {
  try {
    fn();
  } catch (error) {
    showError(error);
  }
};
engine.on("error", showError);

// ── Tools ──────────────────────────────────────────────────────────────────
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
const eraserInput = $<HTMLInputElement>("#eraser-size");
eraserInput.addEventListener(
  "input",
  guard(() => engine.setEraserSize(Number(eraserInput.value))),
);
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
$("#clear").addEventListener("click", async () => {
  if (await askConfirm("Clear every stroke on this page? You can undo it afterwards.", "Clear")) {
    guard(() => engine.clearPage())();
  }
});

// ── Pages and background ───────────────────────────────────────────────────
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
$("#delete-page").addEventListener("click", async () => {
  if (await askConfirm("Delete this page? This cannot be undone.", "Delete")) {
    guard(() => engine.deletePage())();
  }
});
const backgroundSelect = $<HTMLSelectElement>("#background");
backgroundSelect.addEventListener(
  "change",
  guard(() => engine.setPageBackground(createBackground(backgroundSelect.value as BackgroundType))),
);

// ── Zoom and read-only ─────────────────────────────────────────────────────
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

// ── Import / export ──────────────────────────────────────────────────────────
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
    await persistCurrentDocument();
  } catch (error) {
    showError(error);
  }
});

// ── Reflect the state in the UI ────────────────────────────────────────────
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
  eraserInput.value = String(state.eraserSize);
  $("#eraser-size-value").textContent = String(state.eraserSize);
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

/** Only when the document changes (serializing on every zoom would be wasteful). */
function renderStats() {
  const page = engine.getDocument().pages[engine.getState().activePageIndex]!;
  const points = page.elements.reduce((sum, e) => sum + e.points.length / 3, 0);
  const kb = (engine.exportJSON().length / 1024).toFixed(1);
  $("#stats").textContent =
    `Strokes on page: ${page.elements.length} · points: ${points} · document: ${kb} KB`;
}

engine.on("state", () => {
  render();
  renderStats();
});
engine.on("change", (change) => {
  render();
  renderStats();
  $("#change-info").textContent =
    `Last change: ${change.reason}` +
    (change.changedPageIds.length ? ` · pages changed: ${change.changedPageIds.length}` : "") +
    (change.deletedPageIds.length ? ` · deleted: ${change.deletedPageIds.length}` : "");
});

let lastInputUpdate = 0;
engine.on("input", (sample) => {
  const now = performance.now();
  if (now - lastInputUpdate < 100) return;
  lastInputUpdate = now;
  const pressure = sample.hasPressure ? sample.pressure.toFixed(2) : "not reported";
  $("#input-info").textContent =
    `Pointer: ${sample.kind} · pressure: ${pressure}` +
    (engine.getState().penDetected ? " · pen detected (palm ignored)" : "");
});

// ── Save indicator ─────────────────────────────────────────────────────────
const SAVE_LABELS: Record<AutosaveState["status"], string> = {
  idle: "Saved locally",
  dirty: "Unsaved changes",
  saving: "Saving…",
  saved: "Saved locally",
  error: "Save failed — retrying",
};
function renderSave(state: AutosaveState) {
  const info = $("#save-info");
  info.dataset.state = state.status === "idle" ? "saved" : state.status;
  info.textContent = SAVE_LABELS[state.status];
  info.title = state.lastSavedAt ? `Last saved: ${new Date(state.lastSavedAt).toLocaleTimeString()}` : "";
}
autosave.on("state", (state) => {
  renderSave(state);
  if (state.status === "error") showError(state.error);
});

render();
renderStats();
renderSave(autosave.getState());

if (startupError) showError(startupError);
// New document (first visit or unreadable storage): full first save.
if (!savedDocument) persistCurrentDocument().catch(showError);
