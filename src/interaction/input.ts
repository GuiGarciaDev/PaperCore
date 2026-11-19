import { DEFAULT_PRESSURE, MIN_PEN_PRESSURE } from "../core/config.js";

export type PointerKind = "mouse" | "pen" | "touch";

/**
 * Amostra de entrada normalizada (ADR-0007). As ferramentas só consomem isto, então podem ser
 * testadas sem navegador, inclusive simulando pressão de caneta.
 */
export interface InputSample {
  /** Posição em pixels CSS relativos ao canto do container. */
  readonly screenX: number;
  readonly screenY: number;
  /** Posição em coordenadas lógicas da página. */
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly hasPressure: boolean;
  readonly kind: PointerKind;
  readonly time: number;
}

/** Subconjunto de PointerEvent que precisamos (permite testar sem DOM). */
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
 * Só a caneta tem pressão confiável. Mouse informa 0,5 fixo e touch varia entre navegadores,
 * então os dois são tratados como "sem pressão".
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
