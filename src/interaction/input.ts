import { DEFAULT_PRESSURE, MIN_PEN_PRESSURE } from "../core/config.js";

export type PointerKind = "mouse" | "pen" | "touch";

/**
 * Normalized input sample. Tools only consume this, so they can be tested
 * without a browser, including simulated pen pressure.
 */
export interface InputSample {
  /** Position in CSS pixels relative to the container's corner. */
  readonly screenX: number;
  readonly screenY: number;
  /** Position in the page's logical coordinates. */
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly hasPressure: boolean;
  readonly kind: PointerKind;
  readonly time: number;
}

/** The subset of PointerEvent we need (allows testing without a DOM). */
export interface RawPointer {
  readonly clientX: number;
  readonly clientY: number;
  readonly pressure: number;
  readonly pointerType: string;
  readonly timeStamp: number;
}

export function toPointerKind(pointerType: string): PointerKind {
  if (pointerType === "pen" || pointerType === "touch") return pointerType;
  return "mouse";
}

/**
 * Only pens report reliable pressure. Mice report a fixed 0.5 and touch varies across browsers,
 * so both are treated as "no pressure".
 */
export function normalizePressure(
  kind: PointerKind,
  raw: number,
): { pressure: number; hasPressure: boolean } {
  if (kind !== "pen") return { pressure: DEFAULT_PRESSURE, hasPressure: false };
  const pressure =
    Number.isFinite(raw) && raw > 0 ? Math.min(1, Math.max(MIN_PEN_PRESSURE, raw)) : MIN_PEN_PRESSURE;
  return { pressure, hasPressure: true };
}

export function toInputSample(
  raw: RawPointer,
  origin: { left: number; top: number },
  toLogical: (sx: number, sy: number) => { x: number; y: number },
): InputSample {
  const kind = toPointerKind(raw.pointerType);
  const screenX = raw.clientX - origin.left;
  const screenY = raw.clientY - origin.top;
  const logical = toLogical(screenX, screenY);
  return {
    screenX,
    screenY,
    x: logical.x,
    y: logical.y,
    ...normalizePressure(kind, raw.pressure),
    kind,
    time: raw.timeStamp,
  };
}
