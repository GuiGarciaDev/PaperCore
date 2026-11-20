import { elementBounds, rectsIntersect } from "../core/geometry/bounds.js";
import type { StrokeGeometry } from "../core/geometry/strokeOutline.js";
import type { PaperPage } from "../core/types.js";
import { backgroundLines } from "./backgrounds.js";
import type { CanvasLayers, LayerSize } from "./canvasLayers.js";
import { fillStroke, geometryToPaths, strokePaths } from "./strokeRenderer.js";
import { visibleRect, type ViewTransform } from "./viewport.js";

export interface LiveStroke {
  readonly geometry: StrokeGeometry;
  readonly color: string;
}

/** Eraser circle, in logical coordinates. */
export interface EraserCursor {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface RendererTheme {
  readonly pageShadow: string;
  readonly eraserStroke: string;
  readonly eraserFill: string;
}

const DEFAULT_THEME: RendererTheme = {
  pageShadow: "rgba(15, 23, 42, 0.18)",
  eraserStroke: "rgba(71, 85, 105, 0.9)",
  eraserFill: "rgba(148, 163, 184, 0.15)",
};

/**
 * Draws the active page on the three layers. Each layer is only redrawn when it gets "dirty",
 * and at most once per frame (requestAnimationFrame).
 */
export class Renderer {
  private page: PaperPage | null = null;
  private transform: ViewTransform = { scale: 1, offsetX: 0, offsetY: 0 };
  private size: LayerSize = { width: 0, height: 0, pixelRatio: 1 };
  private live: LiveStroke | null = null;
  private cursor: EraserCursor | null = null;
  private dirty = { background: true, content: true, live: true };
  private frame: number | null = null;
  private destroyed = false;
  /** Counters that measure how much rendering work happens (useful in tests and the playground). */
  readonly stats = { frames: 0, backgroundDraws: 0, contentDraws: 0, liveDraws: 0, lastContentElements: 0 };

  constructor(
    private readonly layers: CanvasLayers,
    private readonly theme: RendererTheme = DEFAULT_THEME,
  ) {}

  setPage(page: PaperPage): void {
    const previous = this.page;
    if (previous === page) return;
    this.page = page;
    if (!previous || previous.background !== page.background || previous.size !== page.size) {
      this.dirty.background = true;
    }
    if (!previous || previous.elements !== page.elements) this.dirty.content = true;
    this.schedule();
  }

  setView(transform: ViewTransform, size: LayerSize): void {
    this.transform = transform;
    this.size = size;
    this.dirty = { background: true, content: true, live: true };
    this.schedule();
  }

  setLiveStroke(live: LiveStroke | null): void {
    this.live = live;
    this.dirty.live = true;
    this.schedule();
  }

  setEraserCursor(cursor: EraserCursor | null): void {
    this.cursor = cursor;
    this.dirty.live = true;
    this.schedule();
  }

  /** Immediately draws whatever is dirty (normally called by rAF). */
  renderNow(): void {
    this.frame = null;
    if (this.destroyed || !this.page) return;
    this.stats.frames++;
    if (this.dirty.background) this.drawBackground(this.page);
    if (this.dirty.content) this.drawContent(this.page);
    if (this.dirty.live) this.drawLive();
    this.dirty = { background: false, content: false, live: false };
  }

  destroy(): void {
    this.destroyed = true;
    if (this.frame !== null) this.view()?.cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private view(): Window | null {
    return this.layers.root.ownerDocument.defaultView;
  }

  private schedule(): void {
    if (this.frame !== null || this.destroyed) return;
    const view = this.view();
    if (!view) return;
    this.frame = view.requestAnimationFrame(() => this.renderNow());
  }

  private prepare(ctx: CanvasRenderingContext2D): void {
    const pr = this.size.pixelRatio;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    const { scale, offsetX, offsetY } = this.transform;
    ctx.setTransform(pr * scale, 0, 0, pr * scale, pr * offsetX, pr * offsetY);
  }

  private drawBackground(page: PaperPage): void {
    this.stats.backgroundDraws++;
    const ctx = this.layers.contexts.background;
    this.prepare(ctx);
    const { width, height } = page.size;

    ctx.save();
    ctx.shadowColor = this.theme.pageShadow;
    ctx.shadowBlur = 16 * this.size.pixelRatio;
    ctx.shadowOffsetY = 2 * this.size.pixelRatio;
    ctx.fillStyle = page.background.color;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    if (page.background.type === "blank") return;
    const lines = backgroundLines(
      page.background,
      page.size,
      visibleRect(this.transform, this.size.width, this.size.height),
    );
    const path = new Path2D();
    for (const y of lines.horizontal) {
      path.moveTo(0, y);
      path.lineTo(width, y);
    }
    for (const x of lines.vertical) {
      path.moveTo(x, 0);
      path.lineTo(x, height);
    }
    // At least 1 physical pixel, so lines do not vanish at low zoom.
    ctx.lineWidth = Math.max(page.background.lineWidth, 1 / (this.transform.scale * this.size.pixelRatio));
    ctx.strokeStyle = page.background.lineColor;
    ctx.stroke(path);
  }

  private drawContent(page: PaperPage): void {
    this.stats.contentDraws++;
    const ctx = this.layers.contexts.content;
    this.prepare(ctx);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, page.size.width, page.size.height);
    ctx.clip();
    const visible = visibleRect(this.transform, this.size.width, this.size.height);
    let drawn = 0;
    for (const element of page.elements) {
      if (!rectsIntersect(elementBounds(element), visible)) continue;
      fillStroke(ctx, strokePaths(element), element.style.color);
      drawn++;
    }
    ctx.restore();
    this.stats.lastContentElements = drawn;
  }

  private drawLive(): void {
    this.stats.liveDraws++;
    const ctx = this.layers.contexts.live;
    this.prepare(ctx);
    if (this.live && this.live.geometry.kind !== "empty") {
      fillStroke(ctx, geometryToPaths(this.live.geometry), this.live.color);
    }
    if (this.cursor) {
      const { x, y, radius } = this.cursor;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = this.theme.eraserFill;
      ctx.fill();
      // 1 screen pixel outline at any zoom.
      ctx.lineWidth = 1 / this.transform.scale;
      ctx.strokeStyle = this.theme.eraserStroke;
      ctx.stroke();
    }
  }
}
