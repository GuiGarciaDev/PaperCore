import { POINT_STRIDE } from "../config.js";
import type { PaperElement } from "../types.js";
import { MAX_PRESSURE_FACTOR } from "./pressure.js";

export interface Rect {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** Cache em memória: elementos são imutáveis, então a WeakMap é segura e nunca vai para o documento. */
const cache = new WeakMap<PaperElement, Rect>();

export function elementBounds(element: PaperElement): Rect {
  let rect = cache.get(element);
  if (!rect) {
    rect = computeStrokeBounds(element.points, element.style.width, element.hasPressure);
    cache.set(element, rect);
  }
  return rect;
}

export function computeStrokeBounds(points: readonly number[], width: number, hasPressure: boolean): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i += POINT_STRIDE) {
    const x = points[i]!;
    const y = points[i + 1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const pad = (width / 2) * (hasPressure ? MAX_PRESSURE_FACTOR : 1);
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}
