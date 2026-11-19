import { describe, expect, it } from "vitest";
import { EraserTool } from "../../src/interaction/tools/eraserTool.js";
import { PenTool } from "../../src/interaction/tools/penTool.js";
import { sample, setupTool } from "./toolContext.js";

function setup() {
  const tool = setupTool();
  const pen = new PenTool(tool.ctx);
  const eraser = new EraserTool(tool.ctx);
  const drawLine = (y: number) => {
    pen.begin(sample(0, y));
    for (let x = 2; x <= 200; x += 2) pen.move([sample(x, y)]);
    pen.end();
  };
  return { ...tool, pen, eraser, drawLine };
}

describe("ferramenta borracha", () => {
  it("um gesto que corta dois traços vira UM passo de undo", () => {
    const { eraser, drawLine, strokes, store, pageId } = setup();
    drawLine(100);
    drawLine(140);
    const before = strokes();

    eraser.begin(sample(100, 80));
    for (let y = 82; y <= 160; y += 2) eraser.move([sample(100, y)]);
    eraser.end();

    expect(strokes()).toHaveLength(4); // cada linha virou dois pedaços
    expect(store.undo(pageId)).toBe(true);
    expect(strokes()).toEqual(before);
    expect(store.redo(pageId)).toBe(true);
    expect(strokes()).toHaveLength(4);
  });

  it("mostra a pré-visualização sem tocar no store até soltar", () => {
    const { eraser, drawLine, strokes, previews, cursors } = setup();
    drawLine(100);
    const before = strokes();
    eraser.begin(sample(100, 90));
    eraser.move([sample(100, 110)]);
    expect(strokes()).toBe(before); // store intacto durante o gesto
    expect(previews.at(-1)?.elements).toHaveLength(2);
    expect(cursors.at(-1)).toMatchObject({ x: 100, y: 110, radius: 10 });
    eraser.end();
    expect(previews.at(-1)).toBeNull();
    expect(cursors.at(-1)).toBeNull();
    expect(strokes()).toHaveLength(2);
  });

  it("cancelar descarta o efeito", () => {
    const { eraser, drawLine, strokes, store, pageId } = setup();
    drawLine(100);
    const before = strokes();
    eraser.begin(sample(100, 90));
    eraser.move([sample(100, 110)]);
    eraser.cancel();
    expect(strokes()).toBe(before);
    store.undo(pageId);
    expect(strokes()).toHaveLength(0); // o único passo de undo é o do traço
  });

  it("gesto sem contato não cria passo de undo", () => {
    const { eraser, drawLine, store, pageId } = setup();
    drawLine(100);
    eraser.begin(sample(500, 500));
    eraser.move([sample(520, 520)]);
    eraser.end();
    store.undo(pageId);
    expect(store.canUndo(pageId)).toBe(false);
  });

  it("raio da borracha é em pixels de tela: com zoom, cobre menos área lógica", () => {
    const tool = setupTool();
    const zoomed = { ...tool.ctx, getTransform: () => ({ scale: 4, offsetX: 0, offsetY: 0 }) };
    const eraser = new EraserTool(zoomed);
    eraser.begin(sample(10, 10));
    expect(tool.cursors.at(-1)?.radius).toBe(20 / 2 / 4);
    eraser.cancel();
  });
});
