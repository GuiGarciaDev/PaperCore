import type { Rect } from "../core/geometry/bounds.js";
import type { PageBackground, Size } from "../core/types.js";

export interface BackgroundLines {
  /** Y positions (logical) of the visible horizontal lines. */
  readonly horizontal: readonly number[];
  /** X positions (logical) of the visible vertical lines. */
  readonly vertical: readonly number[];
}

function linesIn(spacing: number, length: number, from: number, to: number): number[] {
  const lines: number[] = [];
  const start = Math.max(1, Math.ceil(Math.max(from, 0) / spacing));
  for (let k = start; k * spacing < length && k * spacing <= to; k++) lines.push(k * spacing);
  return lines;
}

/**
 * Computes ONLY the visible background lines (a pure function, testable without a canvas).
 * The background is configuration, never an image nor a document element.
 */
export function backgroundLines(background: PageBackground, page: Size, visible: Rect): BackgroundLines {
  switch (background.type) {
    case "blank":
      return { horizontal: [], vertical: [] };
    case "ruled":
      return {
        horizontal: linesIn(background.spacing, page.height, visible.minY, visible.maxY),
        vertical: [],
      };
    case "grid":
      return {
        horizontal: linesIn(background.spacing, page.height, visible.minY, visible.maxY),
        vertical: linesIn(background.spacing, page.width, visible.minX, visible.maxX),
      };
  }
}
