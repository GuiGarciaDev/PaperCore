// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBackground } from "../../src/core/document.js";
import { PaperCoreError } from "../../src/core/errors.js";
import type { DocumentChange } from "../../src/core/store.js";
import type { EngineState, PaperCore } from "../../src/engine.js";
import { stroke } from "../helpers.js";
import { installCanvasStubs, mountEngine } from "./setup.js";

let engine: PaperCore;

beforeEach(() => {
  installCanvasStubs();
  ({ engine } = mountEngine());
});

afterEach(() => {
  engine.destroy();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ids = () => engine.getDocument().pages.map((p) => p.id);

function withStroke(pageIndex = 0) {
  const doc = engine.getDocument();
  const pages = doc.pages.map((p, i) => (i === pageIndex ? { ...p, elements: [stroke()] } : p));
  engine.loadDocument({ ...doc, pages });
}

describe("engine: páginas", () => {
  it("addPage cria logo após a ativa, herda o fundo e a seleciona", () => {
    engine.setPageBackground(createBackground("grid"));
    const second = engine.addPage();
    engine.setActivePage(ids()[0]!);
    const middle = engine.addPage();
    expect(ids()).toEqual([ids()[0], middle, second]);
    expect(engine.getState().activePageId).toBe(middle);
    expect(engine.getDocument().pages[1]!.background.type).toBe("grid");
  });

  it("duplicatePage copia os traços com novos ids e seleciona a cópia", () => {
    withStroke();
    const original = engine.getDocument().pages[0]!;
    const copyId = engine.duplicatePage();
    const copy = engine.getDocument().pages[1]!;
    expect(copy.id).toBe(copyId);
    expect(engine.getState().activePageIndex).toBe(1);
    expect(copy.elements).toHaveLength(1);
    expect(copy.elements[0]!.id).not.toBe(original.elements[0]!.id);
  });

  it("excluir a página ativa seleciona a seguinte (ou a anterior, se era a última)", () => {
    const [a] = ids();
    const b = engine.addPage();
    const c = engine.addPage();
    engine.setActivePage(b);
    engine.deletePage();
    expect(engine.getState().activePageId).toBe(c);
    engine.deletePage();
    expect(engine.getState().activePageId).toBe(a);
  });

  it("o evento change da exclusão já sai com a página ativa correta (sem passar pela primeira)", () => {
    const [a] = ids();
    const b = engine.addPage();
    const c = engine.addPage();
    engine.setActivePage(b);
    const seen: { change: DocumentChange; active: string }[] = [];
    const states: EngineState[] = [];
    engine.on("change", (change) => seen.push({ change, active: engine.getState().activePageId }));
    engine.on("state", (state) => states.push(state));
    engine.deletePage();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.change.deletedPageIds).toEqual([b]);
    expect(seen[0]!.active).toBe(c);
    expect(states.some((s) => s.activePageId === a)).toBe(false);
  });

  it("excluir outra página mantém a ativa", () => {
    const b = engine.addPage();
    engine.deletePage(ids()[0]!);
    expect(engine.getState().activePageId).toBe(b);
    expect(engine.getState().activePageIndex).toBe(0);
  });

  it("não exclui a última página nem páginas inexistentes", () => {
    expect(() => engine.deletePage()).toThrow(PaperCoreError);
    expect(() => engine.deletePage("nope")).toThrow(PaperCoreError);
    expect(engine.getState().pageCount).toBe(1);
  });

  it("movePage reordena, mantém a página ativa e atualiza o índice", () => {
    const [a] = ids();
    const b = engine.addPage();
    const c = engine.addPage();
    engine.setActivePage(a!);
    engine.movePage(a!, 2);
    expect(ids()).toEqual([b, c, a]);
    expect(engine.getState().activePageId).toBe(a);
    expect(engine.getState().activePageIndex).toBe(2);
    engine.movePage(a!, -5); // limitado ao intervalo
    expect(ids()[0]).toBe(a);
    expect(() => engine.movePage(a!, 1.5)).toThrow(PaperCoreError);
  });

  it("o histórico é por página: undo na página 2 não afeta a 1", () => {
    engine.clearPage(); // sem traços: nada a desfazer, mas é uma operação válida
    withStroke();
    engine.clearPage();
    expect(engine.getState().canUndo).toBe(true);
    engine.addPage();
    expect(engine.getState().canUndo).toBe(false);
    expect(engine.undo()).toBe(false);
    engine.setActivePage(ids()[0]!);
    expect(engine.undo()).toBe(true);
    expect(engine.getDocument().pages[0]!.elements).toHaveLength(1);
  });

  it("setActivePage com id inexistente lança PAGE_NOT_FOUND", () => {
    expect(() => engine.setActivePage("nope")).toThrow(expect.objectContaining({ code: "PAGE_NOT_FOUND" }));
  });
});

describe("engine: somente leitura", () => {
  it("bloqueia mutações, mas navegação e zoom continuam", () => {
    const b = engine.addPage();
    engine.setReadOnly(true);
    expect(engine.getState().readOnly).toBe(true);
    const readOnly = expect.objectContaining({ code: "READ_ONLY" });
    expect(() => engine.addPage()).toThrow(readOnly);
    expect(() => engine.clearPage()).toThrow(readOnly);
    expect(() => engine.deletePage()).toThrow(readOnly);
    expect(() => engine.movePage(b, 0)).toThrow(readOnly);
    expect(() => engine.setPageBackground(createBackground("blank"))).toThrow(readOnly);

    engine.setActivePage(ids()[0]!);
    engine.zoomIn();
    expect(engine.getState().activePageIndex).toBe(0);
    expect(engine.getState().zoom).toBeGreaterThan(1);

    engine.setReadOnly(false);
    expect(() => engine.clearPage()).not.toThrow();
  });

  it("pode começar em somente leitura", () => {
    engine.destroy();
    ({ engine } = mountEngine({ readOnly: true }));
    expect(engine.getState().readOnly).toBe(true);
    expect(() => engine.addPage()).toThrow(expect.objectContaining({ code: "READ_ONLY" }));
  });
});

describe("engine: eventos change", () => {
  it("informa o motivo e as páginas afetadas", () => {
    const changes: DocumentChange[] = [];
    engine.on("change", (c) => changes.push(c));
    const first = ids()[0]!;
    const added = engine.addPage();
    engine.setActivePage(first);
    withStroke();
    engine.clearPage();
    engine.undo();
    engine.redo();
    expect(changes.map((c) => c.reason)).toEqual(["user", "load", "user", "undo", "redo"]);
    expect(changes[0]!.addedPageIds).toEqual([added]);
    expect(changes[0]!.orderChanged).toBe(true);
    expect(changes[2]!.changedPageIds).toEqual([first]);
  });

  it("loadDocument volta para a primeira página", () => {
    engine.addPage();
    expect(engine.getState().activePageIndex).toBe(1);
    engine.loadDocument(engine.getDocument());
    expect(engine.getState().activePageIndex).toBe(0);
  });

  it("destroy é idempotente, remove o DOM e para de emitir", () => {
    const listener = vi.fn();
    engine.on("change", listener);
    engine.destroy();
    engine.destroy();
    expect(document.querySelector("[data-papercore]")).toBeNull();
    expect(() => engine.addPage()).toThrow(PaperCoreError);
    expect(listener).not.toHaveBeenCalled();
  });
});
