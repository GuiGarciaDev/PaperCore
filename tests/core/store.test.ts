import { describe, expect, it } from "vitest";
import { createBackground, createDocument } from "../../src/core/document.js";
import { addElementsOperation } from "../../src/core/operations.js";
import { PaperStore, type DocumentChange } from "../../src/core/store.js";
import { stroke } from "../helpers.js";

function setup(options?: ConstructorParameters<typeof PaperStore>[1]) {
  const store = new PaperStore(createDocument(), options);
  const changes: DocumentChange[] = [];
  store.on("change", (c) => changes.push(c));
  const firstPageId = store.getDocument().pages[0]!.id;
  const draw = (pageId = firstPageId) => {
    const s = stroke();
    store.apply(addElementsOperation(store.getPage(pageId), [s]));
    return s;
  };
  return { store, changes, firstPageId, draw };
}

describe("PaperStore", () => {
  it("applies, undoes and redoes a stroke", () => {
    const { store, firstPageId, draw } = setup();
    const s = draw();
    expect(store.getPage(firstPageId).elements).toEqual([s]);
    expect(store.undo(firstPageId)).toBe(true);
    expect(store.getPage(firstPageId).elements).toEqual([]);
    expect(store.redo(firstPageId)).toBe(true);
    expect(store.getPage(firstPageId).elements).toEqual([s]);
  });

  it("change listeners already see up-to-date history (canUndo/canRedo)", () => {
    const { store, firstPageId, draw } = setup();
    const seen: [boolean, boolean][] = [];
    store.on("change", () => seen.push([store.canUndo(firstPageId), store.canRedo(firstPageId)]));
    draw();
    store.undo(firstPageId);
    store.redo(firstPageId);
    expect(seen).toEqual([
      [true, false],
      [false, true],
      [true, false],
    ]);
  });

  it("a new action clears redo", () => {
    const { store, firstPageId, draw } = setup();
    draw();
    store.undo(firstPageId);
    draw();
    expect(store.canRedo(firstPageId)).toBe(false);
  });

  it("keeps independent history per page", () => {
    const { store, firstPageId, draw } = setup();
    const second = store.addPage();
    draw(firstPageId);
    const onSecond = draw(second.id);
    store.undo(firstPageId);
    expect(store.getPage(firstPageId).elements).toEqual([]);
    expect(store.getPage(second.id).elements).toEqual([onSecond]);
    expect(store.canUndo(second.id)).toBe(true);
  });

  it("respects the per-page history limit", () => {
    const { store, firstPageId, draw } = setup({ limits: { maxHistoryPerPage: 3 } });
    for (let i = 0; i < 5; i++) draw();
    let undos = 0;
    while (store.undo(firstPageId)) undos++;
    expect(undos).toBe(3);
    expect(store.getPage(firstPageId).elements).toHaveLength(2);
  });

  it("updates are immutable: old snapshots do not change", () => {
    const { store, draw } = setup();
    const before = store.getDocument();
    draw();
    expect(before.pages[0]!.elements).toHaveLength(0);
    expect(store.getDocument()).not.toBe(before);
  });

  it("emits change with the reason and the affected pages", () => {
    const { store, changes, firstPageId, draw } = setup();
    draw();
    store.undo(firstPageId);
    expect(changes.map((c) => c.reason)).toEqual(["user", "undo"]);
    expect(changes[0]!.changedPageIds).toEqual([firstPageId]);
  });

  it("read-only blocks every mutation, including undo", () => {
    const { store, firstPageId, draw } = setup();
    draw();
    store.setReadOnly(true);
    expect(() => draw()).toThrow(/read-only/);
    expect(() => store.addPage()).toThrow(/read-only/);
    expect(() => store.undo(firstPageId)).toThrow(/read-only/);
    expect(store.canUndo(firstPageId)).toBe(false);
    store.setReadOnly(false);
    expect(store.canUndo(firstPageId)).toBe(true);
  });

  it("does not delete the last page", () => {
    const { store, firstPageId } = setup();
    expect(() => store.deletePage(firstPageId)).toThrow(/at least one page/);
  });

  it("deleting a page emits deletedPageIds and drops its history", () => {
    const { store, changes, draw } = setup();
    const second = store.addPage();
    draw(second.id);
    store.deletePage(second.id);
    expect(changes.at(-1)).toMatchObject({ deletedPageIds: [second.id], orderChanged: true });
    expect(store.canUndo(second.id)).toBe(false);
  });

  it("duplicates with new ids, right after the original", () => {
    const { store, firstPageId, draw } = setup();
    const s = draw();
    const copy = store.duplicatePage(firstPageId);
    const pages = store.getDocument().pages;
    expect(pages[1]!.id).toBe(copy.id);
    expect(copy.elements[0]!.id).not.toBe(s.id);
    expect(copy.elements[0]!.points).toEqual(s.points);
  });

  it("moves pages", () => {
    const { store, firstPageId } = setup();
    store.addPage();
    store.movePage(firstPageId, 1);
    expect(store.getDocument().pages[1]!.id).toBe(firstPageId);
  });

  it("changes the background without touching the elements", () => {
    const { store, firstPageId, draw } = setup();
    const s = draw();
    store.setPageBackground(firstPageId, createBackground("grid", { spacing: 40 }));
    const page = store.getPage(firstPageId);
    expect(page.background).toMatchObject({ type: "grid", spacing: 40 });
    expect(page.elements).toEqual([s]);
  });

  it("rejects invalid backgrounds and elements", () => {
    const { store, firstPageId } = setup();
    expect(() => store.setPageBackground(firstPageId, { type: "blank", color: "red" })).toThrow();
    const bad = stroke({ points: [99999, 0, 0.5] });
    expect(() => store.apply(addElementsOperation(store.getPage(firstPageId), [bad]))).toThrow();
  });

  it("clearing a page can be undone", () => {
    const { store, firstPageId, draw } = setup();
    draw();
    draw();
    store.clearPage(firstPageId);
    expect(store.getPage(firstPageId).elements).toHaveLength(0);
    store.undo(firstPageId);
    expect(store.getPage(firstPageId).elements).toHaveLength(2);
  });

  it("load replaces the document, resets history and emits reason=load", () => {
    const { store, changes, firstPageId, draw } = setup();
    draw();
    const next = createDocument();
    store.load(next);
    expect(store.getDocument()).toEqual(next);
    expect(store.canUndo(firstPageId)).toBe(false);
    expect(changes.at(-1)).toMatchObject({ reason: "load", deletedPageIds: [firstPageId] });
  });

  it("respects the page limit", () => {
    const { store } = setup({ limits: { maxPages: 2 } });
    store.addPage();
    expect(() => store.addPage()).toThrow(/Limit of/);
  });
});
