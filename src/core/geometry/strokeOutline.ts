import { POINT_STRIDE } from "../config.js";
import { radiusAt } from "./pressure.js";

export interface Circle {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

/**
 * Geometria pronta para preencher. Não depende de Canvas: o renderizador converte em Path2D.
 * - `dot`: traço de um único ponto (um toque).
 * - `polygon`: contorno fechado (`[x0, y0, x1, y1, …]`) + círculos de reforço em curvas fechadas.
 */
export type StrokeGeometry =
  | { readonly kind: "empty" }
  | { readonly kind: "dot"; readonly circle: Circle }
  | { readonly kind: "polygon"; readonly outline: readonly number[]; readonly joints: readonly Circle[] };

const CAP_SEGMENTS = 8;
/** Curvas mais fechadas que isso recebem um círculo de reforço (cos 75° ≈ 0,26). */
const SHARP_TURN_COS = Math.cos((75 * Math.PI) / 180);
const SMOOTHING_PASSES = 2;

/** Filtro [¼, ½, ¼] mantendo as extremidades. Modifica o array no lugar. */
function smooth(values: number[], passes: number): void {
  const n = values.length;
  if (n < 3) return;
  const tmp = new Array<number>(n);
  for (let pass = 0; pass < passes; pass++) {
    tmp[0] = values[0]!;
    tmp[n - 1] = values[n - 1]!;
    for (let i = 1; i < n - 1; i++) {
      tmp[i] = 0.25 * values[i - 1]! + 0.5 * values[i]! + 0.25 * values[i + 1]!;
    }
    for (let i = 0; i < n; i++) values[i] = tmp[i]!;
  }
}

/**
 * Calcula o contorno de um traço de raio variável (ADR-0005).
 * Função pura: os pontos armazenados são os de entrada, a suavização acontece aqui.
 */
export function strokeOutline(
  points: readonly number[],
  width: number,
  hasPressure: boolean,
): StrokeGeometry {
  const xs: number[] = [];
  const ys: number[] = [];
  const rs: number[] = [];
  for (let i = 0; i + POINT_STRIDE - 1 < points.length; i += POINT_STRIDE) {
    const x = points[i]!;
    const y = points[i + 1]!;
    const r = radiusAt(width, hasPressure, points[i + 2]!);
    const last = xs.length - 1;
    if (last >= 0 && xs[last] === x && ys[last] === y) {
      rs[last] = Math.max(rs[last]!, r);
      continue;
    }
    xs.push(x);
    ys.push(y);
    rs.push(r);
  }

  const n = xs.length;
  if (n === 0) return { kind: "empty" };
  if (n === 1) return { kind: "dot", circle: { x: xs[0]!, y: ys[0]!, r: rs[0]! } };

  smooth(xs, SMOOTHING_PASSES);
  smooth(ys, SMOOTHING_PASSES);
  smooth(rs, SMOOTHING_PASSES);

  const left: number[] = [];
  const right: number[] = [];
  const joints: Circle[] = [];
  const angles: number[] = [];
  let prevNx = 0;
  let prevNy = 0;

  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    let tx = xs[b]! - xs[a]!;
    let ty = ys[b]! - ys[a]!;
    let len = Math.hypot(tx, ty);
    if (len === 0) {
      // Tangente nula (ida e volta exata): reaproveita a normal anterior.
      tx = prevNy;
      ty = -prevNx;
      len = Math.hypot(tx, ty) || 1;
    }
    const nx = -ty / len;
    const ny = tx / len;
    prevNx = nx;
    prevNy = ny;
    const r = rs[i]!;
    left.push(xs[i]! + nx * r, ys[i]! + ny * r);
    right.push(xs[i]! - nx * r, ys[i]! - ny * r);
    angles.push(Math.atan2(ny, nx));

    if (i > 0 && i < n - 1) {
      const ax = xs[i]! - xs[i - 1]!;
      const ay = ys[i]! - ys[i - 1]!;
      const bx = xs[i + 1]! - xs[i]!;
      const by = ys[i + 1]! - ys[i]!;
      const la = Math.hypot(ax, ay);
      const lb = Math.hypot(bx, by);
      if (la > 0 && lb > 0) {
        const cos = Math.min(1, Math.max(-1, (ax * bx + ay * by) / (la * lb)));
        const turn = Math.acos(cos);
        // Raio de curvatura local ≈ comprimento do segmento / ângulo de giro. Se for menor que o raio
        // do traço, o lado interno do contorno se dobra e o preenchimento `nonzero` pode deixar
        // um buraco: um círculo de reforço cobre a dobra.
        const curvatureRadius = turn > 0 ? Math.min(la, lb) / turn : Infinity;
        if (cos < SHARP_TURN_COS || curvatureRadius < r) {
          joints.push({ x: xs[i]!, y: ys[i]!, r });
        }
      }
    }
  }

  const outline: number[] = [...left];
  // Ponta final: do lado esquerdo ao direito passando pela frente (ângulo decrescente).
  const endAngle = angles[n - 1]!;
  const endR = rs[n - 1]!;
  for (let k = 1; k < CAP_SEGMENTS; k++) {
    const t = endAngle - (k * Math.PI) / CAP_SEGMENTS;
    outline.push(xs[n - 1]! + Math.cos(t) * endR, ys[n - 1]! + Math.sin(t) * endR);
  }
  for (let i = n - 1; i >= 0; i--) outline.push(right[2 * i]!, right[2 * i + 1]!);
  // Ponta inicial: do lado direito ao esquerdo passando por trás.
  const startAngle = angles[0]!;
  const startR = rs[0]!;
  for (let k = 1; k < CAP_SEGMENTS; k++) {
    const t = startAngle + Math.PI - (k * Math.PI) / CAP_SEGMENTS;
    outline.push(xs[0]! + Math.cos(t) * startR, ys[0]! + Math.sin(t) * startR);
  }

  return { kind: "polygon", outline, joints };
}
