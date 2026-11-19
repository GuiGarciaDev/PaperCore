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
  it("zoom 1 encaixa a página na largura (descontando a margem)", () => {
    expect(fitScale(metrics)).toBeCloseTo((800 - 48) / 1000);
  });

  it("limita a largura de encaixe em telas largas", () => {
    expect(fitScale({ ...metrics, containerWidth: 3000 })).toBeCloseTo(900 / 1000);
  });

  it("tela → lógica → tela é identidade", () => {
    const t = computeTransform({ zoom: 2.3, centerX: 400, centerY: 700 }, metrics);
    const logical = screenToLogical(t, 123, 456);
    const back = logicalToScreen(t, logical.x, logical.y);
    expect(back.x).toBeCloseTo(123);
    expect(back.y).toBeCloseTo(456);
  });

  it("a mesma coordenada lógica aparece no mesmo lugar relativo em telas diferentes", () => {
    const small: ViewportMetrics = { ...metrics, containerWidth: 400 };
    const state = { zoom: 1, centerX: 500, centerY: 300 };
    const a = logicalToScreen(computeTransform(state, metrics), 500, 300);
    const b = logicalToScreen(computeTransform(state, small), 500, 300);
    expect(a).toEqual({ x: 400, y: 300 });
    expect(b).toEqual({ x: 200, y: 300 });
  });

  it("estado inicial mostra o topo da página", () => {
    const state = initialState(metrics, zoom);
    const t = computeTransform(state, metrics);
    expect(logicalToScreen(t, 0, 0).y).toBeCloseTo(24); // margem
  });

  it("zoomAt mantém fixo o ponto sob o cursor", () => {
    const state = { zoom: 1, centerX: 500, centerY: 700 };
    const before = screenToLogical(computeTransform(state, metrics), 300, 200);
    const next = zoomAt(state, 3, 300, 200, metrics, zoom);
    const after = screenToLogical(computeTransform(next, metrics), 300, 200);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("limita o zoom ao intervalo configurado", () => {
    const state = { zoom: 1, centerX: 500, centerY: 700 };
    expect(zoomAt(state, 100, 0, 0, metrics, zoom).zoom).toBe(zoom.max);
    expect(zoomAt(state, 0.001, 0, 0, metrics, zoom).zoom).toBe(zoom.min);
  });

  it("pan move o conteúdo junto com o dedo", () => {
    const state = { zoom: 2, centerX: 500, centerY: 700 };
    const t0 = computeTransform(state, metrics);
    const t1 = computeTransform(panBy(state, -50, -30, metrics, zoom), metrics);
    expect(t1.offsetX - t0.offsetX).toBeCloseTo(-50);
    expect(t1.offsetY - t0.offsetY).toBeCloseTo(-30);
  });

  it("não deixa a página sair da tela", () => {
    const far = clampState({ zoom: 2, centerX: -9999, centerY: 99999 }, metrics, zoom);
    const t = computeTransform(far, metrics);
    expect(logicalToScreen(t, 0, 0).x).toBeLessThanOrEqual(24 + 1e-9);
    expect(logicalToScreen(t, 0, 1414).y).toBeGreaterThanOrEqual(600 - 24 - 1e-9);
  });

  it("centraliza o eixo em que a página inteira cabe", () => {
    const state = clampState({ zoom: 0.3, centerX: 0, centerY: 0 }, metrics, zoom);
    expect(state.centerX).toBe(500);
    expect(state.centerY).toBe(707);
  });

  it("calcula o retângulo lógico visível", () => {
    const t = computeTransform({ zoom: 1, centerX: 500, centerY: 700 }, metrics);
    const rect = visibleRect(t, 800, 600);
    expect(rect.maxX - rect.minX).toBeCloseTo(800 / t.scale);
  });
});

describe("fundos", () => {
  const page = { width: 1000, height: 1414 };
  const all = { minX: 0, minY: 0, maxX: 1000, maxY: 1414 };

  it("branco não tem linhas", () => {
    expect(backgroundLines({ type: "blank", color: "#ffffff" }, page, all)).toEqual({
      horizontal: [],
      vertical: [],
    });
  });

  it("pautado só tem linhas horizontais dentro da página", () => {
    const bg = { type: "ruled", color: "#ffffff", lineColor: "#000000", spacing: 100, lineWidth: 1 } as const;
    const lines = backgroundLines(bg, page, all);
    expect(lines.vertical).toEqual([]);
    expect(lines.horizontal).toEqual([
      100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400,
    ]);
  });

  it("calcula só as linhas visíveis", () => {
    const bg = { type: "grid", color: "#ffffff", lineColor: "#000000", spacing: 10, lineWidth: 1 } as const;
    const lines = backgroundLines(bg, page, { minX: 95, minY: 195, maxX: 125, maxY: 205 });
    expect(lines.vertical).toEqual([100, 110, 120]);
    expect(lines.horizontal).toEqual([200]);
  });
});

describe("tamanho do canvas", () => {
  it("mantém o DPR do dispositivo quando cabe", () => {
    expect(effectivePixelRatio(1024, 768, 2)).toBe(2);
  });

  it("reduz o DPR para não passar do limite do Safari iOS", () => {
    const dpr = effectivePixelRatio(3000, 3000, 3);
    expect(3000 * 3000 * dpr * dpr).toBeLessThanOrEqual(MAX_CANVAS_PIXELS + 1);
    expect(dpr).toBeLessThan(3);
  });
});
