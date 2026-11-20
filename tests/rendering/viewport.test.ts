import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS } from "../../src/core/config.js";
import { backgroundLines } from "../../src/rendering/backgrounds.js";
import { effectivePixelRatio, MAX_CANVAS_PIXELS } from "../../src/rendering/canvasLayers.js";
import {
  clampState,
  computeTransform,
  fitScale,
  initialState,
  logicalToScreen,
  panBy,
  screenToLogical,
  visibleRect,
  zoomAt,
  type ViewportMetrics,
} from "../../src/rendering/viewport.js";

const zoom = DEFAULT_LIMITS.zoom;
const metrics: ViewportMetrics = {
  containerWidth: 800,
  containerHeight: 600,
  page: { width: 1000, height: 1414 },
};

describe("viewport", () => {
  it("zoom 1 fits the page to the width (minus the margin)", () => {
    expect(fitScale(metrics)).toBeCloseTo((800 - 48) / 1000);
  });

  it("caps the fitted width on wide screens", () => {
    expect(fitScale({ ...metrics, containerWidth: 3000 })).toBeCloseTo(900 / 1000);
  });

  it("screen → logical → screen is the identity", () => {
    const t = computeTransform({ zoom: 2.3, centerX: 400, centerY: 700 }, metrics);
    const logical = screenToLogical(t, 123, 456);
    const back = logicalToScreen(t, logical.x, logical.y);
    expect(back.x).toBeCloseTo(123);
    expect(back.y).toBeCloseTo(456);
  });

  it("the same logical coordinate shows up in the same relative place on different screens", () => {
    const small: ViewportMetrics = { ...metrics, containerWidth: 400 };
    const state = { zoom: 1, centerX: 500, centerY: 300 };
    const a = logicalToScreen(computeTransform(state, metrics), 500, 300);
    const b = logicalToScreen(computeTransform(state, small), 500, 300);
    expect(a).toEqual({ x: 400, y: 300 });
    expect(b).toEqual({ x: 200, y: 300 });
  });

  it("the initial state shows the top of the page", () => {
    const state = initialState(metrics, zoom);
    const t = computeTransform(state, metrics);
    expect(logicalToScreen(t, 0, 0).y).toBeCloseTo(24); // margem
  });

  it("zoomAt keeps the point under the cursor fixed", () => {
    const state = { zoom: 1, centerX: 500, centerY: 700 };
    const before = screenToLogical(computeTransform(state, metrics), 300, 200);
    const next = zoomAt(state, 3, 300, 200, metrics, zoom);
    const after = screenToLogical(computeTransform(next, metrics), 300, 200);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("clamps zoom to the configured range", () => {
    const state = { zoom: 1, centerX: 500, centerY: 700 };
    expect(zoomAt(state, 100, 0, 0, metrics, zoom).zoom).toBe(zoom.max);
    expect(zoomAt(state, 0.001, 0, 0, metrics, zoom).zoom).toBe(zoom.min);
  });

  it("pan moves the content along with the finger", () => {
    const state = { zoom: 2, centerX: 500, centerY: 700 };
    const t0 = computeTransform(state, metrics);
    const t1 = computeTransform(panBy(state, -50, -30, metrics, zoom), metrics);
    expect(t1.offsetX - t0.offsetX).toBeCloseTo(-50);
    expect(t1.offsetY - t0.offsetY).toBeCloseTo(-30);
  });

  it("does not let the page leave the screen", () => {
    const far = clampState({ zoom: 2, centerX: -9999, centerY: 99999 }, metrics, zoom);
    const t = computeTransform(far, metrics);
    expect(logicalToScreen(t, 0, 0).x).toBeLessThanOrEqual(24 + 1e-9);
    expect(logicalToScreen(t, 0, 1414).y).toBeGreaterThanOrEqual(600 - 24 - 1e-9);
  });

  it("centers the axis on which the whole page fits", () => {
    const state = clampState({ zoom: 0.3, centerX: 0, centerY: 0 }, metrics, zoom);
    expect(state.centerX).toBe(500);
    expect(state.centerY).toBe(707);
  });

  it("computes the visible logical rect", () => {
    const t = computeTransform({ zoom: 1, centerX: 500, centerY: 700 }, metrics);
    const rect = visibleRect(t, 800, 600);
    expect(rect.maxX - rect.minX).toBeCloseTo(800 / t.scale);
  });
});

describe("backgrounds", () => {
  const page = { width: 1000, height: 1414 };
  const all = { minX: 0, minY: 0, maxX: 1000, maxY: 1414 };

  it("blank has no lines", () => {
    expect(backgroundLines({ type: "blank", color: "#ffffff" }, page, all)).toEqual({
      horizontal: [],
      vertical: [],
    });
  });

  it("ruled only has horizontal lines inside the page", () => {
    const bg = { type: "ruled", color: "#ffffff", lineColor: "#000000", spacing: 100, lineWidth: 1 } as const;
    const lines = backgroundLines(bg, page, all);
    expect(lines.vertical).toEqual([]);
    expect(lines.horizontal).toEqual([
      100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400,
    ]);
  });

  it("computes only the visible lines", () => {
    const bg = { type: "grid", color: "#ffffff", lineColor: "#000000", spacing: 10, lineWidth: 1 } as const;
    const lines = backgroundLines(bg, page, { minX: 95, minY: 195, maxX: 125, maxY: 205 });
    expect(lines.vertical).toEqual([100, 110, 120]);
    expect(lines.horizontal).toEqual([200]);
  });
});

describe("canvas size", () => {
  it("keeps the device DPR when it fits", () => {
    expect(effectivePixelRatio(1024, 768, 2)).toBe(2);
  });

  it("lowers the DPR to stay under the iOS Safari limit", () => {
    const dpr = effectivePixelRatio(3000, 3000, 3);
    expect(3000 * 3000 * dpr * dpr).toBeLessThanOrEqual(MAX_CANVAS_PIXELS + 1);
    expect(dpr).toBeLessThan(3);
  });
});
