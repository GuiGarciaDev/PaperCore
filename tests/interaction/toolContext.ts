import { resolveLimits, type PartialLimits } from "../../src/core/config.js";
import { createDocument } from "../../src/core/document.js";
import { PaperStore } from "../../src/core/store.js";
import type { PaperDocument, PaperPage, StrokeElement } from "../../src/core/types.js";
import { normalizePressure, type InputSample, type PointerKind } from "../../src/interaction/input.js";
import type { ToolContext } from "../../src/interaction/tools/types.js";
import type { EraserCursor, LiveStroke } from "../../src/rendering/renderer.js";

export function sample(x: number, y: number, kind: PointerKind = "mouse", pressure = 0.5): InputSample {
  return { screenX: x, screenY: y, x, y, ...normalizePressure(kind, pressure), kind, time: 0 };
}

/** DOM-free tool context: scale 1, red pen of width 4, 20 px eraser. */
export function setupTool(options: { limits?: PartialLimits; document?: PaperDocument } = {}) {
  const store = new PaperStore(options.document ?? createDocument(), { limits: options.limits });
  const pageId = store.getDocument().pages[0]!.id;
  const live: (LiveStroke | null)[] = [];
  const previews: (PaperPage | null)[] = [];
  const cursors: (EraserCursor | null)[] = [];
  const pans: [number, number][] = [];
  const ctx: ToolContext = {
    store,
    limits: resolveLimits(options.limits),
    getActivePageId: () => pageId,
    getTransform: () => ({ scale: 1, offsetX: 0, offsetY: 0 }),
    getSettings: () => ({ pen: { color: "#ff0000", width: 4 }, eraserSize: 20 }),
    setLiveStroke: (l) => live.push(l),
    setPreviewPage: (p) => previews.push(p),
    setEraserCursor: (c) => cursors.push(c),
    panBy: (dx, dy) => pans.push([dx, dy]),
  };
  const strokes = () => store.getPage(pageId).elements as StrokeElement[];
  return { store, pageId, ctx, live, previews, cursors, pans, strokes };
}
