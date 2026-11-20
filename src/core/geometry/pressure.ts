/** Maximum factor applied to the radius (pressure = 1). Used to compute bounding boxes. */
export const MAX_PRESSURE_FACTOR = 1.65;

/**
 * Stroke radius at a point. Pressure 0.5 equals the nominal width.
 * Without pressure (mouse/touch), the radius is constant.
 */
export function radiusAt(width: number, hasPressure: boolean, pressure: number): number {
  const factor = hasPressure ? 0.35 + 1.3 * pressure : 1;
  return (width / 2) * factor;
}
