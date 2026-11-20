import { describe, expect, it } from "vitest";
import {
  addElementsOperation,
  applyToElements,
  invertOperation,
  removeElementsOperation,
  type ElementOperation,
} from "../../src/core/operations.js";
import type { PaperElement } from "../../src/core/types.js";
import { docWithStrokes, stroke } from "../helpers.js";

const ids = (elements: readonly PaperElement[]) => elements.map((e) => e.id);

describe("operations", () => {
  it("ADD inserts on top and its inverse removes", () => {
    const page = docWithStrokes(2).pages[0]!;
    const s = stroke();
    const op = addElementsOperation(page, [s]);
    const after = applyToElements(page.elements, op);
    expect(ids(after)).toEqual([...ids(page.elements), s.id]);
    expect(applyToElements(after, invertOperation(op))).toEqual(page.elements);
  });

  it("REMOVE keeps the index: undo restores in the same layer", () => {
    const page = docWithStrokes(5).pages[0]!;
    const target = [page.elements[1]!.id, page.elements[3]!.id];
    const op = removeElementsOperation(page, target);
    const after = applyToElements(page.elements, op);
    expect(ids(after)).not.toContain(target[0]);
    expect(applyToElements(after, invertOperation(op))).toEqual(page.elements);
  });

  it("REPLACE (like the eraser) is atomic and reversible", () => {
    const page = docWithStrokes(3).pages[0]!;
    const original = page.elements[1]!;
    const pieceA = stroke();
    const pieceB = stroke();
    const op: ElementOperation = {
      type: "REPLACE_ELEMENTS",
      pageId: page.id,
      removed: [{ index: 1, element: original }],
      added: [
        { index: 1, element: pieceA },
        { index: 2, element: pieceB },
      ],
    };
    const after = applyToElements(page.elements, op);
    expect(ids(after)).toEqual([page.elements[0]!.id, pieceA.id, pieceB.id, page.elements[2]!.id]);
    expect(applyToElements(after, invertOperation(op))).toEqual(page.elements);
  });

  it("does not modify the original array", () => {
    const page = docWithStrokes(2).pages[0]!;
    const before = page.elements.slice();
    applyToElements(page.elements, removeElementsOperation(page, [page.elements[0]!.id]));
    expect(page.elements).toEqual(before);
  });

  it("reports an inconsistency when removing a missing element", () => {
    const page = docWithStrokes(1).pages[0]!;
    const op: ElementOperation = {
      type: "REMOVE_ELEMENTS",
      pageId: page.id,
      removed: [{ index: 0, element: stroke() }],
    };
    expect(() => applyToElements(page.elements, op)).toThrow(/is not on the page/);
  });

  it("reports an inconsistency when adding a duplicate id", () => {
    const page = docWithStrokes(1).pages[0]!;
    const op = addElementsOperation(page, [page.elements[0]!]);
    expect(() => applyToElements(page.elements, op)).toThrow(/already exists/);
  });
});
