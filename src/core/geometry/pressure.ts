/** Fator máximo aplicado ao raio (pressão = 1). Usado para calcular bounding boxes. */
export const MAX_PRESSURE_FACTOR = 1.65;

/**
 * Raio do traço em um ponto. Pressão 0,5 equivale à espessura nominal.
 * Sem pressão (mouse/touch), o raio é constante.
 */
export function radiusAt(width: number, hasPressure: boolean, pressure: number): number {
  const factor = hasPressure ? 0.35 + 1.3 * pressure : 1;
  return (width / 2) * factor;
}
