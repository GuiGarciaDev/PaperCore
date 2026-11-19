import { PaperCoreError } from "./errors.js";
import type { BackgroundType, PageBackground, Size, StrokeStyle } from "./types.js";

export interface Range {
  readonly min: number;
  readonly max: number;
}

/** Limites centralizados. Todos podem ser sobrescritos via `options.limits`. */
export interface PaperLimits {
  readonly maxPages: number;
  readonly maxElementsPerPage: number;
  /** Quantidade de pontos (não de números) por traço. */
  readonly maxPointsPerStroke: number;
  /** Tamanho máximo do JSON importado, em caracteres. */
  readonly maxImportSize: number;
  readonly maxHistoryPerPage: number;
  readonly zoom: Range;
  readonly penWidth: Range;
  /** Tamanho da borracha em pixels de tela. */
  readonly eraserSize: Range;
  readonly pageSize: Range;
  readonly backgroundSpacing: Range;
  readonly backgroundLineWidth: Range;
}

export const DEFAULT_LIMITS: PaperLimits = Object.freeze({
  maxPages: 200,
  maxElementsPerPage: 5000,
  maxPointsPerStroke: 4000,
  maxImportSize: 20 * 1024 * 1024,
  maxHistoryPerPage: 200,
  zoom: Object.freeze({ min: 0.25, max: 8 }),
  penWidth: Object.freeze({ min: 0.5, max: 40 }),
  eraserSize: Object.freeze({ min: 4, max: 120 }),
  pageSize: Object.freeze({ min: 100, max: 10000 }),
  backgroundSpacing: Object.freeze({ min: 4, max: 400 }),
  backgroundLineWidth: Object.freeze({ min: 0.25, max: 10 }),
});

const RANGE_KEYS = [
  "zoom",
  "penWidth",
  "eraserSize",
  "pageSize",
  "backgroundSpacing",
  "backgroundLineWidth",
] as const;
const COUNT_KEYS = [
  "maxPages",
  "maxElementsPerPage",
  "maxPointsPerStroke",
  "maxImportSize",
  "maxHistoryPerPage",
] as const;

export type PartialLimits = Partial<PaperLimits>;

/** Mescla limites parciais com os padrões, validando a consistência. */
export function resolveLimits(partial?: PartialLimits): PaperLimits {
  const merged: PaperLimits = { ...DEFAULT_LIMITS, ...partial };
  for (const key of COUNT_KEYS) {
    const value = merged[key];
    if (!Number.isInteger(value) || value < 1) {
      throw new PaperCoreError("INVALID_ARGUMENT", `Limite inválido: ${key} deve ser um inteiro ≥ 1.`);
    }
  }
  for (const key of RANGE_KEYS) {
    const range = merged[key];
    if (
      !Number.isFinite(range.min) ||
      !Number.isFinite(range.max) ||
      range.min <= 0 ||
      range.min > range.max
    ) {
      throw new PaperCoreError("INVALID_ARGUMENT", `Limite inválido: ${key} precisa de 0 < min ≤ max.`);
    }
  }
  return Object.freeze(merged);
}

export function clamp(value: number, range: Range): number {
  return Math.min(range.max, Math.max(range.min, value));
}

/** Passo do array plano de pontos: x, y, pressão. */
export const POINT_STRIDE = 3;
/** Quantização das coordenadas e da pressão: 2 casas decimais. */
export const COORD_PRECISION = 100;
/** Pressão gravada quando o dispositivo não informa pressão. */
export const DEFAULT_PRESSURE = 0.5;
/** Menor pressão aceita de uma caneta em contato (algumas reportam 0 no primeiro evento). */
export const MIN_PEN_PRESSURE = 0.05;

/** Proporção próxima do A4 (1 : 1,414). */
export const DEFAULT_PAGE_SIZE: Size = Object.freeze({ width: 1000, height: 1414 });

export const DEFAULT_PEN_STYLE: StrokeStyle = Object.freeze({ color: "#1f2937", width: 3 });
export const DEFAULT_ERASER_SIZE = 20;

export const DEFAULT_BACKGROUNDS: Readonly<Record<BackgroundType, PageBackground>> = Object.freeze({
  blank: Object.freeze({ type: "blank", color: "#ffffff" }),
  ruled: Object.freeze({ type: "ruled", color: "#ffffff", lineColor: "#c7d2fe", spacing: 36, lineWidth: 1 }),
  grid: Object.freeze({ type: "grid", color: "#ffffff", lineColor: "#e2e8f0", spacing: 25, lineWidth: 1 }),
});

export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function quantize(value: number): number {
  return Math.round(value * COORD_PRECISION) / COORD_PRECISION;
}
