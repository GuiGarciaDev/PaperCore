import type { StrokeGeometry } from "../core/geometry/strokeOutline.js";
import { strokeOutline } from "../core/geometry/strokeOutline.js";
import type { StrokeElement } from "../core/types.js";

/**
 * Caminhos de um traço. O contorno e os reforços das juntas ficam em Path2D SEPARADOS e são
 * preenchidos em chamadas separadas: no mesmo caminho, com a regra "nonzero", um círculo de
 * junta com sentido de giro oposto ao do contorno (comum em curvas fechadas de traços grossos)
 * cancela o preenchimento e vira um buraco. A tinta é opaca, então pintar duas vezes não muda
 * a cor.
 */
export interface StrokePaths {
  readonly outline: Path2D;
  /** Todos os círculos de junta (mesmo sentido de giro entre si). `null` se não houver. */
  readonly joints: Path2D | null;
}

/** Elementos são imutáveis, então a WeakMap nunca fica desatualizada. */
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
