import { EraseSession } from "../../core/eraseSession.js";
import { createId } from "../../core/ids.js";
import type { InputSample } from "../input.js";
import type { Tool, ToolContext } from "./types.js";

/**
 * Eraser that cuts strokes.
 *
 * During the gesture, the effect is shown on a preview page (the store does not change).
 * On release, the whole gesture becomes ONE `REPLACE_ELEMENTS` operation, reverted by a single undo.
 */
export class EraserTool implements Tool {
  readonly name = "eraser" as const;
  private session: EraseSession | null = null;
  private pageId: string | null = null;
  private last: { x: number; y: number } | null = null;

  constructor(private readonly ctx: ToolContext) {}

  begin(sample: InputSample): void {
    const pageId = this.ctx.getActivePageId();
    this.pageId = pageId;
    this.session = new EraseSession(this.ctx.store.getPage(pageId), {
      createId,
      maxPointsPerStroke: this.ctx.limits.maxPointsPerStroke,
    });
    this.last = { x: sample.x, y: sample.y };
    this.sweepTo(sample);
  }

  move(samples: readonly InputSample[]): void {
    if (!this.session) return;
    for (const sample of samples) this.sweepTo(sample);
  }

  end(): void {
    const session = this.session;
    const pageId = this.pageId;
    this.reset();
    if (!session || !pageId) return;
    const op = session.toOperation();
    const store = this.ctx.store;
    if (op && store.hasPage(pageId) && !store.isReadOnly()) store.apply(op);
  }

  cancel(): void {
    this.reset();
  }

  private radius(): number {
    return this.ctx.getSettings().eraserSize / 2 / this.ctx.getTransform().scale;
  }

  private sweepTo(sample: InputSample): void {
    const session = this.session;
    const last = this.last;
    if (!session || !last) return;
    const radius = this.radius();
    const changed = session.sweep({ x0: last.x, y0: last.y, x1: sample.x, y1: sample.y, radius });
    this.last = { x: sample.x, y: sample.y };
    if (changed) this.ctx.setPreviewPage(session.previewPage());
    this.ctx.setEraserCursor({ x: sample.x, y: sample.y, radius });
  }

  private reset(): void {
    const hadPreview = this.session?.hasChanges() ?? false;
    this.session = null;
    this.pageId = null;
    this.last = null;
    this.ctx.setEraserCursor(null);
    if (hadPreview) this.ctx.setPreviewPage(null);
  }
}
