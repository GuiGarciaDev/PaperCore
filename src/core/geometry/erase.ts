import { POINT_STRIDE, quantize } from "../config.js";
import type { StrokeElement } from "../types.js";
import { computeStrokeBounds, type Rect } from "./bounds.js";
import { MAX_PRESSURE_FACTOR, radiusAt } from "./pressure.js";

/**
 * Eraser pass between two positions (a "capsule": a segment with a radius).
 * Coordinates and radius in logical units.
 */
export interface EraserSweep {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly radius: number;
}

export interface EraseOptions {
  /** Generates ids for the pieces. */
  readonly createId: () => string;
  /** Pieces never exceed this number of points (the validator would reject them). */
  readonly maxPointsPerStroke: number;
}

/** Squared distance from point (px, py) to segment (ax, ay)–(bx, by). */
export function distanceToSegmentSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx - px;
  const cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

/** Shortest distance between two segments (0 if they intersect). */
function segmentDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): number {
  if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.sqrt(
    Math.min(
      distanceToSegmentSq(ax, ay, cx, cy, dx, dy),
      distanceToSegmentSq(bx, by, cx, cy, dx, dy),
      distanceToSegmentSq(cx, cy, ax, ay, bx, by),
      distanceToSegmentSq(dx, dy, ax, ay, bx, by),
    ),
  );
}

function segmentsIntersect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const cross = (ox: number, oy: number, px: number, py: number, qx: number, qy: number) =>
    (px - ox) * (qy - oy) - (py - oy) * (qx - ox);
  const d1 = cross(cx, cy, dx, dy, ax, ay);
  const d2 = cross(cx, cy, dx, dy, bx, by);
  const d3 = cross(ax, ay, bx, by, cx, cy);
  const d4 = cross(ax, ay, bx, by, dx, dy);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export function sweepBounds(sweep: EraserSweep): Rect {
  return {
    minX: Math.min(sweep.x0, sweep.x1) - sweep.radius,
    minY: Math.min(sweep.y0, sweep.y1) - sweep.radius,
    maxX: Math.max(sweep.x0, sweep.x1) + sweep.radius,
    maxY: Math.max(sweep.y0, sweep.y1) + sweep.radius,
  };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/**
 * Erases from a stroke only the part touched by the eraser.
 *
 * - Returns `null` if the stroke was not touched (the caller keeps the original element).
 * - Returns the remaining pieces (possibly none) if it was touched.
 *
 * The collision uses the eraser radius plus the stroke radius at each point. Long segments near
 * the eraser are subdivided before the test, so the cut never removes more ink than the eraser
 * touched. Pieces with fewer than 2 points are dropped. The ends created by the cut keep the
 * original pressure (they are not tapered).
 */
export function eraseFromStroke(
  stroke: StrokeElement,
  sweep: EraserSweep,
  options: EraseOptions,
): StrokeElement[] | null {
  const { points, style, hasPressure } = stroke;
  const n = points.length / POINT_STRIDE;
  if (n === 0) return null;

  const sweepRect = sweepBounds(sweep);
  if (!overlaps(computeStrokeBounds(points, style.width, hasPressure), sweepRect)) return null;

  const maxReach = sweep.radius + (style.width / 2) * (hasPressure ? MAX_PRESSURE_FACTOR : 1);
  const step = Math.max(0.5, sweep.radius / 2);

  // 1. Subdivide only the segments near the eraser.
  const xs: number[] = [points[0]!];
  const ys: number[] = [points[1]!];
  const ps: number[] = [points[2]!];
  for (let i = 1; i < n; i++) {
    const ax = points[(i - 1) * POINT_STRIDE]!;
    const ay = points[(i - 1) * POINT_STRIDE + 1]!;
    const ap = points[(i - 1) * POINT_STRIDE + 2]!;
    const bx = points[i * POINT_STRIDE]!;
    const by = points[i * POINT_STRIDE + 1]!;
    const bp = points[i * POINT_STRIDE + 2]!;
    const length = Math.hypot(bx - ax, by - ay);
    const near =
      length > step && segmentDistance(ax, ay, bx, by, sweep.x0, sweep.y0, sweep.x1, sweep.y1) <= maxReach;
    if (near) {
      const parts = Math.ceil(length / step);
      for (let k = 1; k < parts; k++) {
        const t = k / parts;
        xs.push(quantize(ax + (bx - ax) * t));
        ys.push(quantize(ay + (by - ay) * t));
        ps.push(quantize(ap + (bp - ap) * t));
      }
    }
    xs.push(bx);
    ys.push(by);
    ps.push(bp);
  }

  // 2. Mark the touched points.
  const erased: boolean[] = new Array<boolean>(xs.length);
  let any = false;
  for (let i = 0; i < xs.length; i++) {
    const reach = sweep.radius + radiusAt(style.width, hasPressure, ps[i]!);
    const hit = distanceToSegmentSq(xs[i]!, ys[i]!, sweep.x0, sweep.y0, sweep.x1, sweep.y1) <= reach * reach;
    erased[i] = hit;
    if (hit) any = true;
  }
  if (!any) return null;

  // 3. Runs of untouched points become pieces.
  const pieces: StrokeElement[] = [];
  let run: number[] = [];
  const flush = () => {
    if (run.length >= 2 * POINT_STRIDE) {
      for (let start = 0; start < run.length;) {
        // Respect the point limit, repeating the joining point between pieces.
        const end = Math.min(run.length, start + options.maxPointsPerStroke * POINT_STRIDE);
        const chunk = run.slice(start, end);
        if (chunk.length >= 2 * POINT_STRIDE) {
          pieces.push({
            id: options.createId(),
            type: "stroke",
            style,
            hasPressure,
            points: chunk,
          });
        }
        if (end >= run.length) break;
        start = end - POINT_STRIDE;
      }
    }
    run = [];
  };
  for (let i = 0; i < xs.length; i++) {
    if (erased[i]) flush();
    else run.push(xs[i]!, ys[i]!, ps[i]!);
  }
  flush();
  return pieces;
}
