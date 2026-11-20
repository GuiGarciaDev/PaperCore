import { clamp, type Range } from "../core/config.js";
import type { Rect } from "../core/geometry/bounds.js";
import type { Size } from "../core/types.js";

/**
 * Viewport state. The center is in the page's LOGICAL COORDINATES:
 * resizing the container keeps the same point centered with no extra math.
 */
export interface ViewportState {
  /** 1 = page fitted to the container width. */
  readonly zoom: number;
  readonly centerX: number;
  readonly centerY: number;
}

export interface ViewportMetrics {
  /** Container size in CSS pixels. */
  readonly containerWidth: number;
  readonly containerHeight: number;
  readonly page: Size;
}

/** Logical → screen (CSS pixels) transform: `screen = logical × scale + offset`. */
export interface ViewTransform {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface ViewportConfig {
  /** Margin around the page, in CSS pixels. */
  readonly padding: number;
  /** Maximum page width at zoom 1, in CSS pixels (avoids a giant page on wide monitors). */
  readonly maxFitWidth: number;
}

export const DEFAULT_VIEWPORT_CONFIG: ViewportConfig = Object.freeze({ padding: 24, maxFitWidth: 900 });

export function fitScale(m: ViewportMetrics, config: ViewportConfig = DEFAULT_VIEWPORT_CONFIG): number {
  const available = Math.min(m.containerWidth - 2 * config.padding, config.maxFitWidth);
  return Math.max(available, 1) / m.page.width;
}

export function computeTransform(
  state: ViewportState,
  m: ViewportMetrics,
  config: ViewportConfig = DEFAULT_VIEWPORT_CONFIG,
): ViewTransform {
  const scale = fitScale(m, config) * state.zoom;
  return {
    scale,
    offsetX: m.containerWidth / 2 - state.centerX * scale,
    offsetY: m.containerHeight / 2 - state.centerY * scale,
  };
}

export function screenToLogical(t: ViewTransform, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - t.offsetX) / t.scale, y: (sy - t.offsetY) / t.scale };
}

export function logicalToScreen(t: ViewTransform, x: number, y: number): { x: number; y: number } {
  return { x: x * t.scale + t.offsetX, y: y * t.scale + t.offsetY };
}

/** Logical rect visible in the container (to cull what is off-screen). */
export function visibleRect(t: ViewTransform, containerWidth: number, containerHeight: number): Rect {
  const a = screenToLogical(t, 0, 0);
  const b = screenToLogical(t, containerWidth, containerHeight);
  return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
}

function clampAxis(center: number, pageLength: number, halfVisible: number, margin: number): number {
  const min = halfVisible - margin;
  const max = pageLength - halfVisible + margin;
  // If the whole page fits on this axis, it stays centered.
  if (min > max) return pageLength / 2;
  return Math.min(max, Math.max(min, center));
}

/** Clamps zoom and center: the page never "escapes" the screen beyond the margin. */
export function clampState(
  state: ViewportState,
  m: ViewportMetrics,
  zoomRange: Range,
  config: ViewportConfig = DEFAULT_VIEWPORT_CONFIG,
): ViewportState {
  const zoom = clamp(state.zoom, zoomRange);
  const scale = fitScale(m, config) * zoom;
  const margin = config.padding / scale;
  return {
    zoom,
    centerX: clampAxis(state.centerX, m.page.width, m.containerWidth / 2 / scale, margin),
    centerY: clampAxis(state.centerY, m.page.height, m.containerHeight / 2 / scale, margin),
  };
}

/** Initial state: zoom 1, showing the top of the page. */
export function initialState(
  m: ViewportMetrics,
  zoomRange: Range,
  config: ViewportConfig = DEFAULT_VIEWPORT_CONFIG,
): ViewportState {
  return clampState({ zoom: 1, centerX: m.page.width / 2, centerY: 0 }, m, zoomRange, config);
}

/** Moves the viewport by a screen-pixel delta (dragging right reveals what is on the left). */
export function panBy(
  state: ViewportState,
  dx: number,
  dy: number,
  m: ViewportMetrics,
  zoomRange: Range,
  config: ViewportConfig = DEFAULT_VIEWPORT_CONFIG,
): ViewportState {
  const scale = fitScale(m, config) * state.zoom;
  return clampState(
    { zoom: state.zoom, centerX: state.centerX - dx / scale, centerY: state.centerY - dy / scale },
    m,
    zoomRange,
    config,
  );
}

/** Applies a zoom keeping the logical point under (sx, sy) fixed. */
export function zoomAt(
  state: ViewportState,
  nextZoom: number,
  sx: number,
  sy: number,
  m: ViewportMetrics,
  zoomRange: Range,
  config: ViewportConfig = DEFAULT_VIEWPORT_CONFIG,
): ViewportState {
  const before = computeTransform(state, m, config);
  const anchor = screenToLogical(before, sx, sy);
  const zoom = clamp(nextZoom, zoomRange);
  const scale = fitScale(m, config) * zoom;
  return clampState(
    {
      zoom,
      centerX: anchor.x - (sx - m.containerWidth / 2) / scale,
      centerY: anchor.y - (sy - m.containerHeight / 2) / scale,
    },
    m,
    zoomRange,
    config,
  );
}
