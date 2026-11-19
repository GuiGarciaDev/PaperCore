import { describe, expect, it } from "vitest";
import { computeStrokeBounds, rectsIntersect } from "../../src/core/geometry/bounds.js";
import { radiusAt } from "../../src/core/geometry/pressure.js";
import { strokeOutline } from "../../src/core/geometry/strokeOutline.js";
import { createId } from "../../src/core/ids.js";

function line(n: number, pressure = 0.5): number[] {
  const points: number[] = [];
  for (let i = 0; i < n; i++) points.push(i * 10, 100, pressure);
  return points;
}

describe("strokeOutline", () => {
  it("devolve vazio sem pontos e um ponto para um toque", () => {
    expect(strokeOutline([], 4, false).kind).toBe("empty");
    const dot = strokeOutline([5, 5, 0.5], 4, false);
    expect(dot).toEqual({ kind: "dot", circle: { x: 5, y: 5, r: 2 } });
  });

  it("trata pontos repetidos como um só", () => {
    expect(strokeOutline([5, 5, 0.5, 5, 5, 0.5], 4, false).kind).toBe("dot");
  });

  it("gera um contorno cuja largura acompanha o raio", () => {
    const geometry = strokeOutline(line(10), 10, false);
    if (geometry.kind !== "polygon") throw new Error("esperado polígono");
    const ys = geometry.outline.filter((_, i) => i % 2 === 1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(10, 5);
  });

  it("a pressão altera a espessura", () => {
    const thin = strokeOutline(line(10, 0.1), 10, true);
    const thick = strokeOutline(line(10, 1), 10, true);
    if (thin.kind !== "polygon" || thick.kind !== "polygon") throw new Error("esperado polígono");
    const height = (o: readonly number[]) => {
      const ys = o.filter((_, i) => i % 2 === 1);
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(height(thick.outline)).toBeGreaterThan(height(thin.outline) * 2);
  });

  it("produz apenas números finitos mesmo com ida e volta exata", () => {
    const geometry = strokeOutline([0, 0, 0.5, 10, 0, 0.5, 0, 0, 0.5, 10, 0, 0.5], 4, true);
    if (geometry.kind !== "polygon") throw new Error("esperado polígono");
    expect(geometry.outline.every(Number.isFinite)).toBe(true);
  });

  it("adiciona reforço em curvas fechadas", () => {
    // Volta em U densa, como a captura real produz (pontos a ~2 unidades).
    const hairpin: number[] = [];
    for (let x = 0; x <= 50; x += 2) hairpin.push(x, 0, 0.5);
    for (let x = 50; x >= 0; x -= 2) hairpin.push(x, 3, 0.5);
    const geometry = strokeOutline(hairpin, 4, false);
    if (geometry.kind !== "polygon") throw new Error("esperado polígono");
    expect(geometry.joints.length).toBeGreaterThan(0);
  });
});

describe("bounds e pressão", () => {
  it("pressão 0,5 equivale à espessura nominal", () => {
    expect(radiusAt(10, true, 0.5)).toBeCloseTo(5);
    expect(radiusAt(10, false, 0.9)).toBe(5);
  });

  it("inclui a espessura na bounding box", () => {
    const rect = computeStrokeBounds([10, 10, 0.5, 20, 30, 0.5], 4, false);
    expect(rect).toEqual({ minX: 8, minY: 8, maxX: 22, maxY: 32 });
    expect(rectsIntersect(rect, { minX: 21, minY: 31, maxX: 40, maxY: 40 })).toBe(true);
    expect(rectsIntersect(rect, { minX: 23, minY: 0, maxX: 40, maxY: 40 })).toBe(false);
  });
});

describe("createId", () => {
  it("gera UUID v4 mesmo sem crypto.randomUUID (contexto inseguro)", () => {
    const original = globalThis.crypto.randomUUID;
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      const id = createId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      Object.defineProperty(globalThis.crypto, "randomUUID", { value: original, configurable: true });
    }
  });
});
