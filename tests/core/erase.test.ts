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

/** Linha horizontal densa (como a captura real produz) em y = 100, de x0 a x1. */
function horizontal(x0: number, x1: number, step = 2, width = 4, pressure = 0.5): StrokeElement {
  const points: number[] = [];
  for (let x = x0; x <= x1; x += step) points.push(x, 100, pressure);
  return stroke({ points, style: { color: "#000000", width } });
}

const xsOf = (s: StrokeElement) => s.points.filter((_, i) => i % 3 === 0);

/** Passada vertical da borracha cruzando a linha y = 100 em x. */
const verticalSweep = (x: number, radius: number): EraserSweep => ({
  x0: x,
  y0: 50,
  x1: x,
  y1: 150,
  radius,
});

describe("eraseFromStroke", () => {
  it("devolve null quando a borracha não toca o traço", () => {
    expect(eraseFromStroke(horizontal(0, 100), verticalSweep(300, 10), options)).toBeNull();
    // Perto, mas fora do alcance (raio da borracha + raio do traço).
    const near = { x0: 50, y0: 113, x1: 60, y1: 113, radius: 10 };
    expect(eraseFromStroke(horizontal(0, 100), near, options)).toBeNull();
  });

  it("corta o traço ao meio, removendo só a parte tocada", () => {
    const pieces = eraseFromStroke(horizontal(0, 200), verticalSweep(100, 10), options);
    expect(pieces).toHaveLength(2);
    const [left, right] = pieces!;
    // Alcance = 10 (borracha) + 2 (raio do traço): sobra tinta até a borda do círculo.
    expect(Math.max(...xsOf(left!))).toBeLessThan(88);
    expect(Math.max(...xsOf(left!))).toBeGreaterThanOrEqual(86);
    expect(Math.min(...xsOf(right!))).toBeGreaterThan(112);
    expect(Math.min(...xsOf(right!))).toBeLessThanOrEqual(114);
  });

  it("considera a espessura do traço na colisão", () => {
    const thin = eraseFromStroke(horizontal(0, 200, 2, 2), verticalSweep(100, 10), options)!;
    const thick = eraseFromStroke(horizontal(0, 200, 2, 20), verticalSweep(100, 10), options)!;
    expect(Math.max(...xsOf(thick[0]!))).toBeLessThan(Math.max(...xsOf(thin[0]!)));
  });

  it("subdivide segmentos longos: não arranca o segmento inteiro", () => {
    // Traço de 2 pontos, de 0 a 1000: a borracha no meio deve deixar quase tudo.
    const line = stroke({ points: [0, 100, 0.5, 1000, 100, 0.5], style: { color: "#000000", width: 4 } });
    const pieces = eraseFromStroke(line, verticalSweep(500, 10), options)!;
    expect(pieces).toHaveLength(2);
    expect(Math.max(...xsOf(pieces[0]!))).toBeGreaterThan(480);
    expect(Math.min(...xsOf(pieces[1]!))).toBeLessThan(520);
  });

  it("apaga um ponto isolado por inteiro e descarta pedaços com menos de 2 pontos", () => {
    expect(eraseFromStroke(stroke({ points: [100, 100, 0.5] }), verticalSweep(100, 5), options)).toEqual([]);
    // Só um ponto sobraria à esquerda: é descartado.
    const short = stroke({ points: [80, 100, 0.5, 100, 100, 0.5, 120, 100, 0.5] });
    const pieces = eraseFromStroke(short, { ...verticalSweep(105, 12) }, options)!;
    expect(pieces.every((p) => p.points.length >= 6)).toBe(true);
  });

  it("as pontas criadas pelo corte mantêm a pressão original (não afinam)", () => {
    const line = horizontal(0, 200, 2, 6, 0.8);
    const [left] = eraseFromStroke({ ...line, hasPressure: true }, verticalSweep(100, 10), options)!;
    expect(left!.points.at(-1)).toBe(0.8);
  });

  it("pedaços são elementos válidos, com novos ids e o mesmo estilo", () => {
    const original = horizontal(0, 200);
    const pieces = eraseFromStroke(original, verticalSweep(100, 10), options)!;
    for (const piece of pieces) {
      expect(piece.id).not.toBe(original.id);
      expect(piece.style).toEqual(original.style);
      expect(validateElement(piece, { width: 1000, height: 1414 }, DEFAULT_LIMITS).ok).toBe(true);
    }
  });

  it("respeita o limite de pontos por traço nos pedaços", () => {
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

  it("várias passadas viram UMA operação REPLACE que o undo reverte exatamente", () => {
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
    // Camadas preservadas: os pedaços ficam entre "below" e "above".
    expect(after[0]).toBe(below);
    expect(after.at(-1)).toBe(above);
    expect(applyToElements(after, invertOperation(op))).toEqual(original.elements);
  });

  it("um pedaço criado e apagado no mesmo gesto não aparece na operação", () => {
    const line = horizontal(0, 200);
    const session = new EraseSession(page([line]), options);
    session.sweep(verticalSweep(100, 10)); // corta ao meio
    session.sweep({ x0: 0, y0: 100, x1: 90, y1: 100, radius: 10 }); // apaga a metade esquerda
    const op = session.toOperation()!;
    const addedIds = op.added.map((a) => a.element.id);
    expect(op.removed.map((r) => r.element.id)).toEqual([line.id]);
    expect(addedIds).toHaveLength(1);
    expect(session.previewPage().elements.map((e) => e.id)).toEqual(addedIds);
  });

  it("sem contato não gera operação", () => {
    const session = new EraseSession(page([horizontal(0, 100)]), options);
    session.sweep(verticalSweep(900, 10));
    expect(session.hasChanges()).toBe(false);
    expect(session.toOperation()).toBeNull();
  });
});
