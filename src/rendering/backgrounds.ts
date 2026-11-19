import type { Rect } from "../core/geometry/bounds.js";
import type { PageBackground, Size } from "../core/types.js";

export interface BackgroundLines {
  /** Posições Y (lógicas) das linhas horizontais visíveis. */
  readonly horizontal: readonly number[];
  /** Posições X (lógicas) das linhas verticais visíveis. */
  readonly vertical: readonly number[];
}

function linesIn(spacing: number, length: number, from: number, to: number): number[] {
  const lines: number[] = [];
  const start = Math.max(1, Math.ceil(Math.max(from, 0) / spacing));
  for (let k = start; k * spacing < length && k * spacing <= to; k++) lines.push(k * spacing);
  return lines;
}

/**
 * Calcula SOMENTE as linhas visíveis do fundo (função pura, testável sem canvas).
 * O fundo é configuração, nunca imagem nem elemento do documento.
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
