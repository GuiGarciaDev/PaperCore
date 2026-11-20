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

describe("engine: pages", () => {
  it("addPage creates right after the active page, inherits the background and selects it", () => {
    engine.setPageBackground(createBackground("grid"));
    const second = engine.addPage();
    engine.setActivePage(ids()[0]!);
    const middle = engine.addPage();
    expect(ids()).toEqual([ids()[0], middle, second]);
    expect(engine.getState().activePageId).toBe(middle);
    expect(engine.getDocument().pages[1]!.background.type).toBe("grid");
  });

  it("duplicatePage copies the strokes with new ids and selects the copy", () => {
    withStroke();
    const original = engine.getDocument().pages[0]!;
    const copyId = engine.duplicatePage();
    const copy = engine.getDocument().pages[1]!;
    expect(copy.id).toBe(copyId);
    expect(engine.getState().activePageIndex).toBe(1);
    expect(copy.elements).toHaveLength(1);
    expect(copy.elements[0]!.id).not.toBe(original.elements[0]!.id);
  });

  it("deleting the active page selects the next one (or the previous one, if it was the last)", () => {
    const [a] = ids();
    const b = engine.addPage();
    const c = engine.addPage();
    engine.setActivePage(b);
    engine.deletePage();
    expect(engine.getState().activePageId).toBe(c);
    engine.deletePage();
    expect(engine.getState().activePageId).toBe(a);
  });

  it("the delete change event already carries the right active page (without passing through the first)", () => {
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

  it("deleting another page keeps the active one", () => {
    const b = engine.addPage();
    engine.deletePage(ids()[0]!);
    expect(engine.getState().activePageId).toBe(b);
    expect(engine.getState().activePageIndex).toBe(0);
  });

  it("does not delete the last page or unknown pages", () => {
    expect(() => engine.deletePage()).toThrow(PaperCoreError);
    expect(() => engine.deletePage("nope")).toThrow(PaperCoreError);
    expect(engine.getState().pageCount).toBe(1);
  });

  it("movePage reorders, keeps the active page and updates the index", () => {
    const [a] = ids();
    const b = engine.addPage();
    const c = engine.addPage();
    engine.setActivePage(a!);
    engine.movePage(a!, 2);
    expect(ids()).toEqual([b, c, a]);
    expect(engine.getState().activePageId).toBe(a);
    expect(engine.getState().activePageIndex).toBe(2);
    engine.movePage(a!, -5); // clamped to the range
    expect(ids()[0]).toBe(a);
    expect(() => engine.movePage(a!, 1.5)).toThrow(PaperCoreError);
  });

  it("history is per page: undo on page 2 does not affect page 1", () => {
    engine.clearPage(); // no strokes: nothing to undo, but it is a valid operation
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

  it("setActivePage with an unknown id throws PAGE_NOT_FOUND", () => {
    expect(() => engine.setActivePage("nope")).toThrow(expect.objectContaining({ code: "PAGE_NOT_FOUND" }));
  });
});

describe("engine: read-only", () => {
  it("blocks mutations, but navigation and zoom keep working", () => {
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

  it("can start in read-only mode", () => {
    engine.destroy();
    ({ engine } = mountEngine({ readOnly: true }));
    expect(engine.getState().readOnly).toBe(true);
    expect(() => engine.addPage()).toThrow(expect.objectContaining({ code: "READ_ONLY" }));
  });
});

describe("engine: change events", () => {
  it("reports the reason and the affected pages", () => {
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

  it("loadDocument goes back to the first page", () => {
    engine.addPage();
    expect(engine.getState().activePageIndex).toBe(1);
    engine.loadDocument(engine.getDocument());
    expect(engine.getState().activePageIndex).toBe(0);
  });

  it("destroy is idempotent, removes the DOM and stops emitting", () => {
    const listener = vi.fn();
    engine.on("change", listener);
    engine.destroy();
    engine.destroy();
    expect(document.querySelector("[data-papercore]")).toBeNull();
    expect(() => engine.addPage()).toThrow(PaperCoreError);
    expect(listener).not.toHaveBeenCalled();
  });
});
