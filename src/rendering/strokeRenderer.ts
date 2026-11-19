import type { StrokeGeometry } from "../core/geometry/strokeOutline.js";
import { strokeOutline } from "../core/geometry/strokeOutline.js";
import type { StrokeElement } from "../core/types.js";

/** Path2D por elemento. Elementos são imutáveis, então a WeakMap nunca fica desatualizada. */
const pathCache = new WeakMap<StrokeElement, Path2D>();

export function geometryToPath(geometry: StrokeGeometry): Path2D {
  const path = new Path2D();
  if (geometry.kind === "dot") {
    const { x, y, r } = geometry.circle;
    path.arc(x, y, r, 0, Math.PI * 2);
  } else if (geometry.kind === "polygon") {
    const o = geometry.outline;
    path.moveTo(o[0]!, o[1]!);
    for (let i = 2; i < o.length; i += 2) path.lineTo(o[i]!, o[i + 1]!);
    path.closePath();
    for (const { x, y, r } of geometry.joints) {
      path.moveTo(x + r, y);
      path.arc(x, y, r, 0, Math.PI * 2);
    }
  }
  return path;
}

export function strokePath(element: StrokeElement): Path2D {
  let path = pathCache.get(element);
  if (!path) {
    path = geometryToPath(strokeOutline(element.points, element.style.width, element.hasPressure));
    pathCache.set(element, path);
  }
  return path;
}

export function fillPath(ctx: CanvasRenderingContext2D, path: Path2D, color: string): void {
  ctx.fillStyle = color;
  ctx.fill(path, "nonzero");
}
