import type { StrokeGeometry } from "../core/geometry/strokeOutline.js";
import { strokeOutline } from "../core/geometry/strokeOutline.js";
import type { StrokeElement } from "../core/types.js";

/**
 * Paths of a stroke. The outline and the joint reinforcements live in SEPARATE Path2Ds and are
 * filled in separate calls: in a single path, with the "nonzero" rule, a joint circle whose
 * winding is opposite to the outline's (common on tight curves of thick strokes) cancels the
 * fill and becomes a hole. Ink is opaque, so painting twice does not change the
 * color.
 */
export interface StrokePaths {
  readonly outline: Path2D;
  /** All joint circles (same winding among themselves). `null` if there are none. */
  readonly joints: Path2D | null;
}

/** Elements are immutable, so the WeakMap never goes stale. */
const pathCache = new WeakMap<StrokeElement, StrokePaths>();

export function geometryToPaths(geometry: StrokeGeometry): StrokePaths {
  const outline = new Path2D();
  let joints: Path2D | null = null;
  if (geometry.kind === "dot") {
    const { x, y, r } = geometry.circle;
    outline.arc(x, y, r, 0, Math.PI * 2);
  } else if (geometry.kind === "polygon") {
    const o = geometry.outline;
    outline.moveTo(o[0]!, o[1]!);
    for (let i = 2; i < o.length; i += 2) outline.lineTo(o[i]!, o[i + 1]!);
    outline.closePath();
    if (geometry.joints.length > 0) {
      joints = new Path2D();
      for (const { x, y, r } of geometry.joints) {
        joints.moveTo(x + r, y);
        joints.arc(x, y, r, 0, Math.PI * 2);
      }
    }
  }
  return { outline, joints };
}

export function strokePaths(element: StrokeElement): StrokePaths {
  let paths = pathCache.get(element);
  if (!paths) {
    paths = geometryToPaths(strokeOutline(element.points, element.style.width, element.hasPressure));
    pathCache.set(element, paths);
  }
  return paths;
}

export function fillStroke(ctx: CanvasRenderingContext2D, paths: StrokePaths, color: string): void {
  ctx.fillStyle = color;
  ctx.fill(paths.outline, "nonzero");
  if (paths.joints) ctx.fill(paths.joints, "nonzero");
}
