import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { strokeOutline } from "../../src/core/geometry/strokeOutline.js";
import { fillStroke, geometryToPaths } from "../../src/rendering/strokeRenderer.js";

/** Path2D falso (o Node não tem canvas): registra só quantos subcaminhos foram abertos. */
class FakePath2D {
  arcs = 0;
  lines = 0;
  moveTo() {}
  lineTo() {
    this.lines++;
  }
  arc() {
    this.arcs++;
  }
  closePath() {}
}

beforeAll(() => vi.stubGlobal("Path2D", FakePath2D));
afterAll(() => vi.unstubAllGlobals());

/** Grampo (ida e volta) grosso: força juntas. */
function hairpin(): number[] {
  const points: number[] = [];
  for (let x = 0; x <= 100; x += 5) points.push(x, 100, 0.5);
  for (let x = 100; x >= 0; x -= 5) points.push(x, 110, 0.5);
  return points;
}

describe("fillStroke", () => {
  it("preenche juntas e contorno em chamadas separadas (regressão: buracos em curvas grossas)", () => {
    const geometry = strokeOutline(hairpin(), 30, false);
    expect(geometry.kind).toBe("polygon");
    if (geometry.kind !== "polygon") return;
    expect(geometry.joints.length).toBeGreaterThan(0);

    const paths = geometryToPaths(geometry);
    const outline = paths.outline as unknown as FakePath2D;
    const joints = paths.joints as unknown as FakePath2D;
    // O contorno não pode conter círculos: no mesmo caminho, a regra nonzero os cancelaria.
    expect(outline.arcs).toBe(0);
    expect(joints.arcs).toBe(geometry.joints.length);

    const fills: unknown[] = [];
    const ctx = { fillStyle: "", fill: (path: unknown) => fills.push(path) };
    fillStroke(ctx as unknown as CanvasRenderingContext2D, paths, "#000000");
    expect(fills).toEqual([paths.outline, paths.joints]);
  });

  it("sem juntas, um único preenchimento", () => {
    const paths = geometryToPaths(strokeOutline([0, 0, 0.5, 50, 0, 0.5], 4, false));
    expect(paths.joints).toBeNull();
    const fill = vi.fn();
    fillStroke({ fillStyle: "", fill } as unknown as CanvasRenderingContext2D, paths, "#000000");
    expect(fill).toHaveBeenCalledTimes(1);
  });
});
