/** Maior área de canvas que o Safari iOS aceita sem deixar o canvas em branco. */
export const MAX_CANVAS_PIXELS = 16_777_216;

export type LayerName = "background" | "content" | "live";

export interface LayerSize {
  /** Pixels CSS. */
  readonly width: number;
  readonly height: number;
  /** DPR efetivo (pode ser menor que o do dispositivo, ver `effectivePixelRatio`). */
  readonly pixelRatio: number;
}

/** Reduz o DPR para que o canvas não ultrapasse `MAX_CANVAS_PIXELS` (ADR-0006). */
export function effectivePixelRatio(width: number, height: number, devicePixelRatio: number): number {
  const dpr = Math.max(1, devicePixelRatio || 1);
  const area = width * height;
  if (area <= 0) return dpr;
  const maxDpr = Math.sqrt(MAX_CANVAS_PIXELS / area);
  return Math.max(0.5, Math.min(dpr, maxDpr));
}

/**
 * Três canvases empilhados com o tamanho do VIEWPORT (nunca página × zoom).
 * O canvas de cima ("live") recebe os eventos de ponteiro.
 */
export class CanvasLayers {
  readonly root: HTMLDivElement;
  readonly canvases: Readonly<Record<LayerName, HTMLCanvasElement>>;
  readonly contexts: Readonly<Record<LayerName, CanvasRenderingContext2D>>;
  private size: LayerSize = { width: 0, height: 0, pixelRatio: 1 };
  private readonly resizeObserver: ResizeObserver;
  private dprQuery: MediaQueryList | null = null;
  private readonly onDprChange = () => this.measure();
  private destroyed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly onResize: (size: LayerSize) => void,
  ) {
    const doc = container.ownerDocument;
    this.root = doc.createElement("div");
    this.root.dataset.papercore = "surface";
    Object.assign(this.root.style, {
      position: "relative",
      width: "100%",
      height: "100%",
      overflow: "hidden",
      touchAction: "none",
      userSelect: "none",
      webkitUserSelect: "none",
      outline: "none",
    });
    this.root.style.setProperty("-webkit-touch-callout", "none");

    const make = (name: LayerName): HTMLCanvasElement => {
      const canvas = doc.createElement("canvas");
      canvas.dataset.layer = name;
      Object.assign(canvas.style, {
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        display: "block",
        pointerEvents: name === "live" ? "auto" : "none",
      });
      this.root.appendChild(canvas);
      return canvas;
    };
    const canvases = { background: make("background"), content: make("content"), live: make("live") };
    const ctx = (canvas: HTMLCanvasElement) => {
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas 2D não suportado neste navegador.");
      return context;
    };
    this.canvases = canvases;
    this.contexts = {
      background: ctx(canvases.background),
      content: ctx(canvases.content),
      live: ctx(canvases.live),
    };
    container.appendChild(this.root);

    this.resizeObserver = new ResizeObserver(() => this.measure());
    this.resizeObserver.observe(this.root);
    this.measure();
  }

  getSize(): LayerSize {
    return this.size;
  }

  /** Recalcula o tamanho (container e DPR) e redimensiona os canvases se necessário. */
  measure(): void {
    if (this.destroyed) return;
    const rect = this.root.getBoundingClientRect();
    const view = this.container.ownerDocument.defaultView;
    const width = Math.max(0, rect.width);
    const height = Math.max(0, rect.height);
    const pixelRatio = effectivePixelRatio(width, height, view?.devicePixelRatio ?? 1);
    this.watchDpr(view);
    if (width === this.size.width && height === this.size.height && pixelRatio === this.size.pixelRatio)
      return;
    this.size = { width, height, pixelRatio };
    for (const canvas of Object.values(this.canvases)) {
      canvas.width = Math.max(1, Math.round(width * pixelRatio));
      canvas.height = Math.max(1, Math.round(height * pixelRatio));
    }
    this.onResize(this.size);
  }

  /** Mudar a janela de monitor altera o DPR sem redimensionar o elemento. */
  private watchDpr(view: Window | null): void {
    if (!view?.matchMedia) return;
    this.dprQuery?.removeEventListener("change", this.onDprChange);
    this.dprQuery = view.matchMedia(`(resolution: ${view.devicePixelRatio}dppx)`);
    this.dprQuery.addEventListener("change", this.onDprChange);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resizeObserver.disconnect();
    this.dprQuery?.removeEventListener("change", this.onDprChange);
    this.root.remove();
  }
}
