import { PaperCoreError } from "./errors.js";
import type { PaperElement, PaperPage } from "./types.js";

export interface IndexedElement {
  /** In `removed`: index in the PREVIOUS state. In `added`: index in the NEXT state. */
  readonly index: number;
  readonly element: PaperElement;
}

export interface AddElementsOperation {
  readonly type: "ADD_ELEMENTS";
  readonly pageId: string;
  readonly added: readonly IndexedElement[];
}

export interface RemoveElementsOperation {
  readonly type: "REMOVE_ELEMENTS";
  readonly pageId: string;
  readonly removed: readonly IndexedElement[];
}

/** Removes and adds atomically (e.g. the eraser cuts a stroke into pieces). */
export interface ReplaceElementsOperation {
  readonly type: "REPLACE_ELEMENTS";
  readonly pageId: string;
  readonly removed: readonly IndexedElement[];
  readonly added: readonly IndexedElement[];
}

export type ElementOperation = AddElementsOperation | RemoveElementsOperation | ReplaceElementsOperation;

const NONE: readonly IndexedElement[] = [];

function removedOf(op: ElementOperation): readonly IndexedElement[] {
  return op.type === "ADD_ELEMENTS" ? NONE : op.removed;
}

function addedOf(op: ElementOperation): readonly IndexedElement[] {
  return op.type === "REMOVE_ELEMENTS" ? NONE : op.added;
}

/** Elements the operation adds (useful to validate before applying). */
export function addedElements(op: ElementOperation): readonly IndexedElement[] {
  return addedOf(op);
}

/** Inverse operation: swap `removed` and `added`. */
export function invertOperation(op: ElementOperation): ElementOperation {
  switch (op.type) {
    case "ADD_ELEMENTS":
      return { type: "REMOVE_ELEMENTS", pageId: op.pageId, removed: op.added };
    case "REMOVE_ELEMENTS":
      return { type: "ADD_ELEMENTS", pageId: op.pageId, added: op.removed };
    case "REPLACE_ELEMENTS":
      return { type: "REPLACE_ELEMENTS", pageId: op.pageId, removed: op.added, added: op.removed };
  }
}

/**
 * Applies the operation to a list of elements and returns a NEW list.
 * Removes in descending index order and inserts in ascending order.
 * Throws `INCONSISTENT_OPERATION` if an element to remove does not exist.
 */
export function applyToElements(elements: readonly PaperElement[], op: ElementOperation): PaperElement[] {
  const result = elements.slice();

  const removed = [...removedOf(op)].sort((a, b) => b.index - a.index);
  for (const item of removed) {
    let index = item.index;
    if (result[index]?.id !== item.element.id) {
      index = result.findIndex((element) => element.id === item.element.id);
    }
    if (index < 0) {
      throw new PaperCoreError("INCONSISTENT_OPERATION", `Element ${item.element.id} is not on the page.`);
    }
    result.splice(index, 1);
  }

  const added = [...addedOf(op)].sort((a, b) => a.index - b.index);
  const existingIds = new Set(result.map((element) => element.id));
  for (const item of added) {
    if (existingIds.has(item.element.id)) {
      throw new PaperCoreError(
        "INCONSISTENT_OPERATION",
        `Element ${item.element.id} already exists on the page.`,
      );
    }
    existingIds.add(item.element.id);
    result.splice(Math.min(Math.max(item.index, 0), result.length), 0, item.element);
  }
  return result;
}

/** Creates an operation that adds elements on top of the page. */
export function addElementsOperation(
  page: PaperPage,
  elements: readonly PaperElement[],
): AddElementsOperation {
  return {
    type: "ADD_ELEMENTS",
    pageId: page.id,
    added: elements.map((element, i) => ({ index: page.elements.length + i, element })),
  };
}

/** Creates an operation that removes the elements with the given ids (ignoring unknown ids). */
export function removeElementsOperation(page: PaperPage, ids: Iterable<string>): RemoveElementsOperation {
  const wanted = new Set(ids);
  const removed: IndexedElement[] = [];
  page.elements.forEach((element, index) => {
    if (wanted.has(element.id)) removed.push({ index, element });
  });
  return { type: "REMOVE_ELEMENTS", pageId: page.id, removed };
}

export function isEmptyOperation(op: ElementOperation): boolean {
  return removedOf(op).length === 0 && addedOf(op).length === 0;
}
