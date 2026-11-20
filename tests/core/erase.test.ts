import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS } from "../../src/core/config.js";
import { createDocument } from "../../src/core/document.js";
import { EraseSession } from "../../src/core/eraseSession.js";
import { eraseFromStroke, type EraserSweep } from "../../src/core/geometry/erase.js";
import { applyToElements, invertOperation } from "../../src/core/operations.js";
import type { PaperPage, StrokeElement } from "../../src/core/types.js";
import { validateElement } from "../../src/core/validation.js";
import { stroke } from "../helpers.js";

let ids = 0;
const options = { createId: () => `piece${++ids}`, maxPointsPerStroke: 4000 };

/** Dense horizontal line (as real capture produces) at y = 100, from x0 to x1. */
function horizontal(x0: number, x1: number, step = 2, width = 4, pressure = 0.5): StrokeElement {
  const points: number[] = [];
  for (let x = x0; x <= x1; x += step) points.push(x, 100, pressure);
  return stroke({ points, style: { color: "#000000", width } });
}

const xsOf = (s: StrokeElement) => s.points.filter((_, i) => i % 3 === 0);

/** Vertical eraser sweep crossing the line y = 100 at x. */
const verticalSweep = (x: number, radius: number): EraserSweep => ({
  x0: x,
  y0: 50,
  x1: x,
  y1: 150,
  radius,
});

describe("eraseFromStroke", () => {
  it("returns null when the eraser does not touch the stroke", () => {
    expect(eraseFromStroke(horizontal(0, 100), verticalSweep(300, 10), options)).toBeNull();
    // Close, but out of reach (eraser radius + stroke radius).
    const near = { x0: 50, y0: 113, x1: 60, y1: 113, radius: 10 };
    expect(eraseFromStroke(horizontal(0, 100), near, options)).toBeNull();
  });

  it("cuts the stroke in half, removing only the touched part", () => {
    const pieces = eraseFromStroke(horizontal(0, 200), verticalSweep(100, 10), options);
    expect(pieces).toHaveLength(2);
    const [left, right] = pieces!;
    // Reach = 10 (eraser) + 2 (stroke radius): ink remains up to the edge of the circle.
    expect(Math.max(...xsOf(left!))).toBeLessThan(88);
    expect(Math.max(...xsOf(left!))).toBeGreaterThanOrEqual(86);
    expect(Math.min(...xsOf(right!))).toBeGreaterThan(112);
    expect(Math.min(...xsOf(right!))).toBeLessThanOrEqual(114);
  });

  it("takes the stroke width into account in the collision", () => {
    const thin = eraseFromStroke(horizontal(0, 200, 2, 2), verticalSweep(100, 10), options)!;
    const thick = eraseFromStroke(horizontal(0, 200, 2, 20), verticalSweep(100, 10), options)!;
    expect(Math.max(...xsOf(thick[0]!))).toBeLessThan(Math.max(...xsOf(thin[0]!)));
  });

  it("subdivides long segments: does not rip out the whole segment", () => {
    // A 2-point stroke from 0 to 1000: erasing the middle must keep almost everything.
    const line = stroke({ points: [0, 100, 0.5, 1000, 100, 0.5], style: { color: "#000000", width: 4 } });
    const pieces = eraseFromStroke(line, verticalSweep(500, 10), options)!;
    expect(pieces).toHaveLength(2);
    expect(Math.max(...xsOf(pieces[0]!))).toBeGreaterThan(480);
    expect(Math.min(...xsOf(pieces[1]!))).toBeLessThan(520);
  });

  it("erases a lone point entirely and drops pieces with fewer than 2 points", () => {
    expect(eraseFromStroke(stroke({ points: [100, 100, 0.5] }), verticalSweep(100, 5), options)).toEqual([]);
    // Only one point would remain on the left: it is dropped.
    const short = stroke({ points: [80, 100, 0.5, 100, 100, 0.5, 120, 100, 0.5] });
    const pieces = eraseFromStroke(short, { ...verticalSweep(105, 12) }, options)!;
    expect(pieces.every((p) => p.points.length >= 6)).toBe(true);
  });

  it("the ends created by the cut keep the original pressure (no tapering)", () => {
    const line = horizontal(0, 200, 2, 6, 0.8);
    const [left] = eraseFromStroke({ ...line, hasPressure: true }, verticalSweep(100, 10), options)!;
    expect(left!.points.at(-1)).toBe(0.8);
  });

  it("pieces are valid elements, with new ids and the same style", () => {
    const original = horizontal(0, 200);
    const pieces = eraseFromStroke(original, verticalSweep(100, 10), options)!;
    for (const piece of pieces) {
      expect(piece.id).not.toBe(original.id);
      expect(piece.style).toEqual(original.style);
      expect(validateElement(piece, { width: 1000, height: 1414 }, DEFAULT_LIMITS).ok).toBe(true);
    }
  });

  it("respects the points-per-stroke limit in the pieces", () => {
    const pieces = eraseFromStroke(horizontal(0, 600, 1), verticalSweep(300, 10), {
      ...options,
      maxPointsPerStroke: 50,
    })!;
    expect(pieces.length).toBeGreaterThan(2);
    expect(pieces.every((p) => p.points.length / 3 <= 50)).toBe(true);
  });
});

describe("EraseSession", () => {
  function page(elements: StrokeElement[]): PaperPage {
    return { ...createDocument().pages[0]!, elements };
  }

  it("several sweeps become ONE REPLACE operation that undo reverts exactly", () => {
    const below = horizontal(0, 200);
    const target = {
      ...horizontal(0, 200),
      points: horizontal(0, 200).points.map((v, i) => (i % 3 === 1 ? 300 : v)),
    };
    const above = horizontal(0, 50);
    const original = page([below, target, above]);
    const session = new EraseSession(original, options);
    session.sweep({ x0: 60, y0: 280, x1: 60, y1: 320, radius: 5 });
    session.sweep({ x0: 140, y0: 280, x1: 140, y1: 320, radius: 5 });
    const op = session.toOperation()!;
    expect(op.type).toBe("REPLACE_ELEMENTS");
    expect(op.removed.map((r) => r.element.id)).toEqual([target.id]);
    expect(op.added).toHaveLength(3);

    const after = applyToElements(original.elements, op);
    expect(after).toEqual(session.previewPage().elements);
    // Layers preserved: the pieces sit between "below" and "above".
    expect(after[0]).toBe(below);
    expect(after.at(-1)).toBe(above);
    expect(applyToElements(after, invertOperation(op))).toEqual(original.elements);
  });

  it("a piece created and erased in the same gesture does not show up in the operation", () => {
    const line = horizontal(0, 200);
    const session = new EraseSession(page([line]), options);
    session.sweep(verticalSweep(100, 10)); // cuts in half
    session.sweep({ x0: 0, y0: 100, x1: 90, y1: 100, radius: 10 }); // erases the left half
    const op = session.toOperation()!;
    const addedIds = op.added.map((a) => a.element.id);
    expect(op.removed.map((r) => r.element.id)).toEqual([line.id]);
    expect(addedIds).toHaveLength(1);
    expect(session.previewPage().elements.map((e) => e.id)).toEqual(addedIds);
  });

  it("no contact produces no operation", () => {
    const session = new EraseSession(page([horizontal(0, 100)]), options);
    session.sweep(verticalSweep(900, 10));
    expect(session.hasChanges()).toBe(false);
    expect(session.toOperation()).toBeNull();
  });
});
