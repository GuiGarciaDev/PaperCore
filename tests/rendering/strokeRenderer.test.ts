import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { strokeOutline } from "../../src/core/geometry/strokeOutline.js";
import { fillStroke, geometryToPaths } from "../../src/rendering/strokeRenderer.js";

/** Fake Path2D (Node has no canvas): only records how many subpaths were opened. */
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

/** A thick hairpin (out and back): forces joints. */
function hairpin(): number[] {
  const points: number[] = [];
  for (let x = 0; x <= 100; x += 5) points.push(x, 100, 0.5);
  for (let x = 100; x >= 0; x -= 5) points.push(x, 110, 0.5);
  return points;
}

describe("fillStroke", () => {
  it("fills joints and outline in separate calls (regression: holes in thick curves)", () => {
    const geometry = strokeOutline(hairpin(), 30, false);
    expect(geometry.kind).toBe("polygon");
    if (geometry.kind !== "polygon") return;
    expect(geometry.joints.length).toBeGreaterThan(0);

    const paths = geometryToPaths(geometry);
    const outline = paths.outline as unknown as FakePath2D;
    const joints = paths.joints as unknown as FakePath2D;
    // The outline must not contain circles: in the same path, the nonzero rule would cancel them.
    expect(outline.arcs).toBe(0);
    expect(joints.arcs).toBe(geometry.joints.length);

    const fills: unknown[] = [];
    const ctx = { fillStyle: "", fill: (path: unknown) => fills.push(path) };
    fillStroke(ctx as unknown as CanvasRenderingContext2D, paths, "#000000");
    expect(fills).toEqual([paths.outline, paths.joints]);
  });

  it("without joints, a single fill", () => {
    const paths = geometryToPaths(strokeOutline([0, 0, 0.5, 50, 0, 0.5], 4, false));
    expect(paths.joints).toBeNull();
    const fill = vi.fn();
    fillStroke({ fillStyle: "", fill } as unknown as CanvasRenderingContext2D, paths, "#000000");
    expect(fill).toHaveBeenCalledTimes(1);
  });
});
