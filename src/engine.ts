import {
  clamp,
  DEFAULT_ERASER_SIZE,
  DEFAULT_PEN_STYLE,
  HEX_COLOR_PATTERN,
  type PartialLimits,
} from "./core/config.js";
import { createDocument } from "./core/document.js";
import { Emitter } from "./core/emitter.js";
import { PaperCoreError } from "./core/errors.js";
import { parseDocument, serializeDocument } from "./core/serialization.js";
import { PaperStore, type DocumentChange } from "./core/store.js";
import type { PageBackground, PaperDocument, StrokeStyle } from "./core/types.js";
import type { InputSample, PointerKind } from "./interaction/input.js";
import { PointerController, type PinchUpdate, type WheelUpdate } from "./interaction/pointerController.js";
import { PointerPolicy, type InputPolicyOptions } from "./interaction/pointerPolicy.js";
import { EraserTool } from "./interaction/tools/eraserTool.js";
import { PanTool } from "./interaction/tools/panTool.js";
import { PenTool } from "./interaction/tools/penTool.js";
import type { Tool, ToolContext, ToolName } from "./interaction/tools/types.js";
import { CanvasLayers, type LayerSize } from "./rendering/canvasLayers.js";
import { Renderer } from "./rendering/renderer.js";
import {
  clampState,
  computeTransform,
  DEFAULT_VIEWPORT_CONFIG,
  initialState,
  panBy,
  screenToLogical,
  zoomAt,
  type ViewportConfig,
  type ViewportMetrics,
  type ViewportState,
  type ViewTransform,
} from "./rendering/viewport.js";

export interface PaperCoreOptions {
  /** Documento inicial. Sem ele, um documento novo com uma página pautada é criado. */
  document?: PaperDocument;
  readOnly?: boolean;
  limits?: PartialLimits;
  input?: InputPolicyOptions;
  /** Atalhos (Ctrl/⌘+Z, Ctrl/⌘+Shift+Z, Ctrl+Y) só com a superfície em foco. Padrão: `false`. */
  keyboardShortcuts?: boolean;
  tool?: ToolName;
  pen?: Partial<StrokeStyle>;
  /** Diâmetro da borracha em pixels de tela. */
  eraserSize?: number;
  viewport?: Partial<ViewportConfig>;
}

/** Estado de interface, imutável e estável entre chamadas (seguro para `useSyncExternalStore`). */
export interface EngineState {
  readonly activePageId: string;
  readonly activePageIndex: number;
  readonly pageCount: number;
  readonly tool: ToolName;
  readonly pen: StrokeStyle;
  readonly eraserSize: number;
  readonly zoom: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly readOnly: boolean;
  readonly penDetected: boolean;
}

export interface PaperCoreEvents {
  /** O documento mudou. Use `changedPageIds` para persistir só o necessário. */
  change: DocumentChange;
  /** O estado de interface mudou (ferramenta, zoom, página ativa, undo/redo…). */
  state: EngineState;
  /** Erro durante uma interação (por exemplo, limite de elementos atingido). */
  error: PaperCoreError;
  /** Cada amostra de entrada processada (útil para depurar caneta/pressão). */
  input: InputSample;
}

export interface PaperCore {
  getDocument(): PaperDocument;
  /** Substitui o documento (por exemplo, a versão vinda do servidor). Reinicia o histórico. */
  loadDocument(document: PaperDocument): void;
  exportJSON(): string;
  /** Valida, migra e carrega um JSON. Lança `PaperCoreError` se for inválido. */
  importJSON(json: string): void;

  getState(): EngineState;
  setActivePage(pageId: string): void;
  /** Cria uma página logo após a ativa e a seleciona. Devolve o id. */
  addPage(options?: { background?: PageBackground }): string;
  duplicatePage(pageId?: string): string;
  /** Exclui a página (não pode ser desfeito). Peça confirmação ao usuário antes. */
  deletePage(pageId?: string): void;
  setPageBackground(background: PageBackground, pageId?: string): void;
  /** Remove todos os traços da página (pode ser desfeito). */
  clearPage(pageId?: string): void;

  setTool(tool: ToolName): void;
  setPenStyle(style: Partial<StrokeStyle>): void;
  /** Diâmetro da borracha em pixels de tela (limitado por `limits.eraserSize`). */
  setEraserSize(size: number): void;
  undo(): boolean;
  redo(): boolean;

  zoomIn(): void;
  zoomOut(): void;
  setZoom(zoom: number): void;
  /** Volta ao zoom 1, mostrando o topo da página. */
  resetView(): void;

  setReadOnly(readOnly: boolean): void;

  on<K extends keyof PaperCoreEvents>(type: K, listener: (payload: PaperCoreEvents[K]) => void): () => void;
  /** Remove listeners, observers, frames e elementos criados. Pode ser chamado mais de uma vez. */
  destroy(): void;
}

const ZOOM_STEP = 1.25;
/** `PointerEvent.button` da ponta de borracha de canetas digitais. */
const PEN_ERASER_BUTTON = 5;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;

/** Cria o motor dentro de `container` (que precisa ter tamanho definido pelo CSS). */
export function createPaperCore(container: HTMLElement, options: PaperCoreOptions = {}): PaperCore {
  return new Engine(container, options);
}

class Engine implements PaperCore {
  private readonly store: PaperStore;
  private readonly emitter = new Emitter<PaperCoreEvents>();
  private readonly layers: CanvasLayers;
  private readonly renderer: Renderer;
  private readonly controller: PointerController;
  private readonly policy: PointerPolicy;
  private readonly tools: Record<ToolName, Tool>;
  private readonly viewportConfig: ViewportConfig;
  private readonly unsubscribeStore: () => void;
  private readonly keyboardShortcuts: boolean;
  private activePageId: string;
  private tool: ToolName;
  private pen: StrokeStyle;
  private eraserSize: number;
  private viewport: ViewportState = { zoom: 1, centerX: 0, centerY: 0 };
  private transform: ViewTransform = { scale: 1, offsetX: 0, offsetY: 0 };
  private size: LayerSize = { width: 0, height: 0, pixelRatio: 1 };
  private state: EngineState;
  private destroyed = false;
  private ready = false;

  constructor(container: HTMLElement, options: PaperCoreOptions) {
    this.store = new PaperStore(options.document ?? createDocument(), {
      limits: options.limits,
      readOnly: options.readOnly,
    });
    this.viewportConfig = { ...DEFAULT_VIEWPORT_CONFIG, ...options.viewport };
    this.activePageId = this.store.getDocument().pages[0]!.id;
    this.tool = options.tool ?? "pen";
    this.pen = this.normalizePen({ ...DEFAULT_PEN_STYLE, ...options.pen });
    this.eraserSize = this.normalizeEraserSize(options.eraserSize ?? DEFAULT_ERASER_SIZE);
    this.policy = new PointerPolicy(options.input);
    this.keyboardShortcuts = options.keyboardShortcuts ?? false;

    const ctx: ToolContext = {
      store: this.store,
      limits: this.store.limits,
      getActivePageId: () => this.activePageId,
      getTransform: () => this.transform,
      getSettings: () => ({ pen: this.pen, eraserSize: this.eraserSize }),
      setLiveStroke: (live) => this.renderer.setLiveStroke(live),
      setPreviewPage: (page) => this.renderer.setPage(page ?? this.store.getPage(this.activePageId)),
      setEraserCursor: (cursor) => this.renderer.setEraserCursor(cursor),
      panBy: (dx, dy) =>
        this.applyViewport(
          panBy(this.viewport, dx, dy, this.metrics(), this.zoomRange(), this.viewportConfig),
        ),
    };
    this.tools = { pen: new PenTool(ctx), eraser: new EraserTool(ctx), pan: new PanTool(ctx) };

    this.layers = new CanvasLayers(container, (size) => this.onResize(size));
    this.renderer = new Renderer(this.layers);
    this.state = this.buildState();

    this.controller = new PointerController(this.layers.canvases.live, {
      policy: this.policy,
      resolveTool: (kind, button) => this.resolveTool(kind, button),
      toLogical: (sx, sy) => screenToLogical(this.transform, sx, sy),
      pinch: (update) => this.onPinch(update),
      wheel: (update) => this.onWheel(update),
      onSample: (sample) => this.emitter.emit("input", sample),
      onError: (error) => this.reportError(error),
    });

    if (this.keyboardShortcuts) {
      this.layers.root.tabIndex = 0;
      this.layers.root.setAttribute("aria-label", "Área de desenho");
      this.layers.root.addEventListener("keydown", this.onKeyDown);
      this.layers.canvases.live.addEventListener("pointerdown", this.focusSurface);
    }

    this.unsubscribeStore = this.store.on("change", (change) => this.onStoreChange(change));

    this.ready = true;
    this.size = this.layers.getSize();
    this.viewport = initialState(this.metrics(), this.zoomRange(), this.viewportConfig);
    this.applyViewport(this.viewport);
    this.renderer.setPage(this.store.getPage(this.activePageId));
  }

  // ── Documento ────────────────────────────────────────────────────────────

  getDocument(): PaperDocument {
    return this.store.getDocument();
  }

  loadDocument(document: PaperDocument): void {
    this.assertAlive();
    this.controller.cancelActive();
    this.store.load(document);
  }

  exportJSON(): string {
    return serializeDocument(this.store.getDocument());
  }

  importJSON(json: string): void {
    this.loadDocument(parseDocument(json, this.store.limits));
  }

  // ── Páginas ──────────────────────────────────────────────────────────────

  getState(): EngineState {
    return this.state;
  }

  setActivePage(pageId: string): void {
    this.assertAlive();
    if (pageId === this.activePageId) return;
    this.store.getPage(pageId); // lança PAGE_NOT_FOUND se não existir
    this.controller.endActive();
    this.setActivePageInternal(pageId);
  }

  addPage(options: { background?: PageBackground } = {}): string {
    this.assertAlive();
    const pages = this.store.getDocument().pages;
    const index = pages.findIndex((p) => p.id === this.activePageId) + 1;
    const background = options.background ?? this.store.getPage(this.activePageId).background;
    const page = this.store.addPage({ index, background });
    this.setActivePage(page.id);
    return page.id;
  }

  duplicatePage(pageId = this.activePageId): string {
    this.assertAlive();
    const copy = this.store.duplicatePage(pageId);
    this.setActivePage(copy.id);
    return copy.id;
  }

  deletePage(pageId = this.activePageId): void {
    this.assertAlive();
    const pages = this.store.getDocument().pages;
    const index = pages.findIndex((p) => p.id === pageId);
    if (pageId === this.activePageId) this.controller.cancelActive();
    this.store.deletePage(pageId);
    if (pageId === this.activePageId) {
      const remaining = this.store.getDocument().pages;
      this.setActivePageInternal(remaining[Math.min(index, remaining.length - 1)]!.id);
    }
  }

  setPageBackground(background: PageBackground, pageId = this.activePageId): void {
    this.assertAlive();
    this.store.setPageBackground(pageId, background);
  }

  clearPage(pageId = this.activePageId): void {
    this.assertAlive();
    this.store.clearPage(pageId);
  }

  // ── Ferramentas e histórico ──────────────────────────────────────────────

  setTool(tool: ToolName): void {
    this.assertAlive();
    if (!(tool in this.tools))
      throw new PaperCoreError("INVALID_ARGUMENT", `Ferramenta desconhecida: ${tool}`);
    this.controller.endActive();
    this.tool = tool;
    this.refreshState();
  }

  setPenStyle(style: Partial<StrokeStyle>): void {
    this.assertAlive();
    this.pen = this.normalizePen({ ...this.pen, ...style });
    this.refreshState();
  }

  setEraserSize(size: number): void {
    this.assertAlive();
    this.eraserSize = this.normalizeEraserSize(size);
    this.refreshState();
  }

  undo(): boolean {
    this.assertAlive();
    if (!this.store.canUndo(this.activePageId)) return false;
    this.controller.endActive();
    return this.store.undo(this.activePageId);
  }

  redo(): boolean {
    this.assertAlive();
    if (!this.store.canRedo(this.activePageId)) return false;
    this.controller.endActive();
    return this.store.redo(this.activePageId);
  }

  // ── Viewport ─────────────────────────────────────────────────────────────

  zoomIn(): void {
    this.zoomAroundCenter(this.viewport.zoom * ZOOM_STEP);
  }

  zoomOut(): void {
    this.zoomAroundCenter(this.viewport.zoom / ZOOM_STEP);
  }

  setZoom(zoom: number): void {
    if (!Number.isFinite(zoom)) throw new PaperCoreError("INVALID_ARGUMENT", "Zoom inválido.");
    this.zoomAroundCenter(zoom);
  }

  resetView(): void {
    this.assertAlive();
    this.applyViewport(initialState(this.metrics(), this.zoomRange(), this.viewportConfig));
  }

  // ── Modo somente leitura ─────────────────────────────────────────────────

  setReadOnly(readOnly: boolean): void {
    this.assertAlive();
    if (readOnly) this.controller.cancelActive();
    this.store.setReadOnly(readOnly);
    this.refreshState();
  }

  // ── Eventos e ciclo de vida ──────────────────────────────────────────────

  on<K extends keyof PaperCoreEvents>(type: K, listener: (payload: PaperCoreEvents[K]) => void): () => void {
    return this.emitter.on(type, listener);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.controller.destroy();
    this.unsubscribeStore();
    this.layers.root.removeEventListener("keydown", this.onKeyDown);
    this.layers.canvases.live.removeEventListener("pointerdown", this.focusSurface);
    this.renderer.destroy();
    this.layers.destroy();
    this.store.destroy();
    this.emitter.clear();
  }

  // ── Internos ─────────────────────────────────────────────────────────────

  private resolveTool(kind: PointerKind, button: number): Tool | null {
    if (button === 2) return null; // botão direito
    if (button === 1) return this.tools.pan; // botão do meio
    if (this.store.isReadOnly()) return button > 2 ? null : this.tools.pan;
    // Ponta traseira das canetas (Surface/Wacom) chega como pointerType "pen" e botão 5.
    if (kind === "pen" && button === PEN_ERASER_BUTTON) return this.tools.eraser;
    if (button > 2) return null; // botões extras do mouse
    const editing = this.tool === "pen" || this.tool === "eraser";
    if (editing && !this.policy.canDraw(kind)) return this.tools.pan;
    return this.tools[this.tool];
  }

  private onStoreChange(change: DocumentChange): void {
    if (change.reason === "load" || !this.store.hasPage(this.activePageId)) {
      this.setActivePageInternal(this.store.getDocument().pages[0]!.id);
    } else {
      this.renderer.setPage(this.store.getPage(this.activePageId));
      this.refreshState();
    }
    this.emitter.emit("change", change);
  }

  private setActivePageInternal(pageId: string): void {
    this.activePageId = pageId;
    this.renderer.setPage(this.store.getPage(pageId));
    this.viewport = initialState(this.metrics(), this.zoomRange(), this.viewportConfig);
    this.applyViewport(this.viewport);
  }

  private onResize(size: LayerSize): void {
    this.size = size;
    if (!this.ready) return;
    this.applyViewport(this.viewport);
  }

  private onPinch(update: PinchUpdate): void {
    const m = this.metrics();
    const range = this.zoomRange();
    const panned = panBy(
      this.viewport,
      update.toX - update.fromX,
      update.toY - update.fromY,
      m,
      range,
      this.viewportConfig,
    );
    this.applyViewport(
      zoomAt(panned, panned.zoom * update.ratio, update.toX, update.toY, m, range, this.viewportConfig),
    );
  }

  private onWheel(update: WheelUpdate): void {
    const m = this.metrics();
    const range = this.zoomRange();
    if (update.zoom) {
      const zoom = this.viewport.zoom * Math.exp(-update.dy * WHEEL_ZOOM_SENSITIVITY);
      this.applyViewport(zoomAt(this.viewport, zoom, update.x, update.y, m, range, this.viewportConfig));
    } else {
      this.applyViewport(panBy(this.viewport, -update.dx, -update.dy, m, range, this.viewportConfig));
    }
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === "z" && !e.shiftKey) {
      e.preventDefault();
      this.undo();
    } else if ((key === "z" && e.shiftKey) || key === "y") {
      e.preventDefault();
      this.redo();
    }
  };

  private readonly focusSurface = (): void => {
    this.layers.root.focus({ preventScroll: true });
  };

  private zoomAroundCenter(zoom: number): void {
    this.assertAlive();
    const m = this.metrics();
    this.applyViewport(
      zoomAt(
        this.viewport,
        zoom,
        m.containerWidth / 2,
        m.containerHeight / 2,
        m,
        this.zoomRange(),
        this.viewportConfig,
      ),
    );
  }

  private applyViewport(next: ViewportState): void {
    const m = this.metrics();
    this.viewport = clampState(next, m, this.zoomRange(), this.viewportConfig);
    this.transform = computeTransform(this.viewport, m, this.viewportConfig);
    this.renderer.setView(this.transform, this.size);
    this.refreshState();
  }

  private metrics(): ViewportMetrics {
    return {
      containerWidth: this.size.width,
      containerHeight: this.size.height,
      page: this.store.getPage(this.activePageId).size,
    };
  }

  private zoomRange() {
    return this.store.limits.zoom;
  }

  private normalizePen(style: StrokeStyle): StrokeStyle {
    if (!HEX_COLOR_PATTERN.test(style.color)) {
      throw new PaperCoreError("INVALID_ARGUMENT", `Cor inválida: ${style.color} (use #rrggbb).`);
    }
    if (!Number.isFinite(style.width)) throw new PaperCoreError("INVALID_ARGUMENT", "Espessura inválida.");
    return { color: style.color.toLowerCase(), width: clamp(style.width, this.store.limits.penWidth) };
  }

  private normalizeEraserSize(size: number): number {
    if (!Number.isFinite(size)) throw new PaperCoreError("INVALID_ARGUMENT", "Tamanho de borracha inválido.");
    return clamp(size, this.store.limits.eraserSize);
  }

  private buildState(): EngineState {
    const pages = this.store.getDocument().pages;
    return {
      activePageId: this.activePageId,
      activePageIndex: pages.findIndex((p) => p.id === this.activePageId),
      pageCount: pages.length,
      tool: this.tool,
      pen: this.pen,
      eraserSize: this.eraserSize,
      zoom: this.viewport.zoom,
      canUndo: this.store.canUndo(this.activePageId),
      canRedo: this.store.canRedo(this.activePageId),
      readOnly: this.store.isReadOnly(),
      penDetected: this.policy.isPenDetected(),
    };
  }

  /** Recalcula o estado e só emite se algo mudou (snapshot estável). */
  private refreshState(): void {
    if (!this.ready || this.destroyed) return;
    const next = this.buildState();
    const prev = this.state;
    const changed = (Object.keys(next) as (keyof EngineState)[]).some((key) => next[key] !== prev[key]);
    if (!changed) return;
    this.state = next;
    this.emitter.emit("state", next);
  }

  private reportError(error: unknown): void {
    const wrapped =
      error instanceof PaperCoreError
        ? error
        : new PaperCoreError("INVALID_ARGUMENT", error instanceof Error ? error.message : String(error));
    this.emitter.emit("error", wrapped);
  }

  private assertAlive(): void {
    if (this.destroyed) throw new PaperCoreError("INVALID_ARGUMENT", "O motor já foi destruído.");
  }
}
