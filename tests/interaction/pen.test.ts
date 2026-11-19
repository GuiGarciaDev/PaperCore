import { describe, expect, it } from "vitest";
import { resolveLimits, type PartialLimits } from "../../src/core/config.js";
import { createDocument } from "../../src/core/document.js";
import { PaperStore } from "../../src/core/store.js";
import type { StrokeElement } from "../../src/core/types.js";
import {
  normalizePressure,
  toInputSample,
  type InputSample,
  type PointerKind,
} from "../../src/interaction/input.js";
import { PointerPolicy } from "../../src/interaction/pointerPolicy.js";
import { PanTool } from "../../src/interaction/tools/panTool.js";
import { PenTool } from "../../src/interaction/tools/penTool.js";
import type { ToolContext } from "../../src/interaction/tools/types.js";
import type { LiveStroke } from "../../src/rendering/renderer.js";

function sample(x: number, y: number, kind: PointerKind = "mouse", pressure = 0.5): InputSample {
  return { screenX: x, screenY: y, x, y, ...normalizePressure(kind, pressure), kind, time: 0 };
}

function setup(limits?: PartialLimits) {
  const store = new PaperStore(createDocument(), { limits });
  const pageId = store.getDocument().pages[0]!.id;
  const live: (LiveStroke | null)[] = [];
  const pans: [number, number][] = [];
  const ctx: ToolContext = {
    store,
    limits: resolveLimits(limits),
    getActivePageId: () => pageId,
    getTransform: () => ({ scale: 1, offsetX: 0, offsetY: 0 }),
    getSettings: () => ({ pen: { color: "#ff0000", width: 4 } }),
    setLiveStroke: (l) => live.push(l),
    panBy: (dx, dy) => pans.push([dx, dy]),
  };
  const strokes = () => store.getPage(pageId).elements as StrokeElement[];
  return { store, pageId, ctx, live, pans, strokes, pen: new PenTool(ctx) };
}

describe("caneta", () => {
  it("um gesto completo vira UMA operação/elemento com o estilo atual", () => {
    const { pen, strokes, store, pageId } = setup();
    pen.begin(sample(10, 10));
    pen.move([sample(20, 20), sample(30, 25)]);
    pen.move([sample(40, 30)]);
    pen.end();
    expect(strokes()).toHaveLength(1);
    expect(strokes()[0]!.style).toEqual({ color: "#ff0000", width: 4 });
    expect(strokes()[0]!.points).toEqual([10, 10, 0.5, 20, 20, 0.5, 30, 25, 0.5, 40, 30, 0.5]);
    store.undo(pageId);
    expect(strokes()).toHaveLength(0);
  });

  it("registra pressão real da caneta e marca hasPressure", () => {
    const { pen, strokes } = setup();
    pen.begin(sample(10, 10, "pen", 0.2));
    pen.move([sample(20, 10, "pen", 0.9)]);
    pen.end();
    expect(strokes()[0]!.hasPressure).toBe(true);
    expect(strokes()[0]!.points).toEqual([10, 10, 0.2, 20, 10, 0.9]);
  });

  it("descarta pontos redundantes, mas mantém o ponto final exato", () => {
    const { pen, strokes } = setup();
    pen.begin(sample(10, 10));
    pen.move([sample(10.1, 10.1), sample(10.2, 10.2), sample(10.3, 10.3)]);
    pen.end();
    expect(strokes()[0]!.points).toEqual([10, 10, 0.5, 10.3, 10.3, 0.5]);
  });

  it("quantiza em 2 casas e recorta pontos fora da página", () => {
    const { pen, strokes } = setup();
    pen.begin(sample(-50, 10.12345));
    pen.move([sample(5000, 99999)]);
    pen.end();
    expect(strokes()[0]!.points).toEqual([0, 10.12, 0.5, 1000, 1414, 0.5]);
  });

  it("cancelar descarta o traço e limpa a camada ao vivo", () => {
    const { pen, strokes, live } = setup();
    pen.begin(sample(10, 10));
    pen.move([sample(50, 50)]);
    pen.cancel();
    expect(strokes()).toHaveLength(0);
    expect(live.at(-1)).toBeNull();
  });

  it("atualiza a camada ao vivo durante o traço", () => {
    const { pen, live } = setup();
    pen.begin(sample(10, 10));
    pen.move([sample(50, 50)]);
    expect(live.at(-1)?.geometry.kind).toBe("polygon");
    expect(live.at(-1)?.color).toBe("#ff0000");
  });

  it("ao atingir o limite de pontos continua em um novo traço sem perder amostras", () => {
    const { pen, strokes } = setup({ maxPointsPerStroke: 5 });
    pen.begin(sample(0, 0));
    pen.move(Array.from({ length: 11 }, (_, i) => sample((i + 1) * 10, 0)));
    pen.end();
    const all = strokes();
    expect(all.length).toBeGreaterThan(1);
    // Os traços se encadeiam: cada um começa onde o anterior terminou.
    for (let i = 1; i < all.length; i++) {
      const prev = all[i - 1]!.points;
      expect(all[i]!.points.slice(0, 2)).toEqual(prev.slice(-3, -1));
    }
    expect(all.at(-1)!.points.slice(-3, -1)).toEqual([110, 0]);
    expect(all.every((s) => s.points.length / 3 <= 5)).toBe(true);
  });

  it("em somente leitura não confirma o traço", () => {
    const { pen, strokes, store } = setup();
    pen.begin(sample(10, 10));
    store.setReadOnly(true);
    pen.end();
    expect(strokes()).toHaveLength(0);
  });
});

describe("pan", () => {
  it("converte o arrasto em deslocamento de tela", () => {
    const { ctx, pans } = setup();
    const pan = new PanTool(ctx);
    pan.begin(sample(10, 10));
    pan.move([sample(15, 12), sample(30, 40)]);
    pan.end();
    expect(pans).toEqual([[20, 30]]);
  });
});

describe("entrada", () => {
  it("só a caneta tem pressão; pressão zero vira o mínimo", () => {
    expect(normalizePressure("mouse", 0.8)).toEqual({ pressure: 0.5, hasPressure: false });
    expect(normalizePressure("touch", 1)).toEqual({ pressure: 0.5, hasPressure: false });
    expect(normalizePressure("pen", 0)).toEqual({ pressure: 0.05, hasPressure: true });
    expect(normalizePressure("pen", 0.7)).toEqual({ pressure: 0.7, hasPressure: true });
  });

  it("converte o evento em coordenadas lógicas usando a transformação recebida", () => {
    const s = toInputSample(
      { clientX: 110, clientY: 220, pressure: 0.4, pointerType: "pen", timeStamp: 5 },
      { left: 10, top: 20 },
      (sx, sy) => ({ x: sx / 2, y: sy / 2 }),
    );
    expect(s).toMatchObject({ screenX: 100, screenY: 200, x: 50, y: 100, kind: "pen", pressure: 0.4 });
  });

  it("rejeição de palma: depois de ver uma caneta, o toque não desenha", () => {
    const policy = new PointerPolicy();
    expect(policy.canDraw("touch")).toBe(true);
    policy.observe("pen");
    expect(policy.canDraw("touch")).toBe(false);
    expect(policy.canDraw("pen")).toBe(true);
  });

  it("respeita a lista de ponteiros que podem desenhar", () => {
    const policy = new PointerPolicy({ drawWith: ["pen"], palmRejection: false });
    expect(policy.canDraw("mouse")).toBe(false);
    expect(policy.canDraw("pen")).toBe(true);
  });
});
