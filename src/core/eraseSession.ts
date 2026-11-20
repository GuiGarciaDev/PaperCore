import { eraseFromStroke, sweepBounds, type EraseOptions, type EraserSweep } from "./geometry/erase.js";
import { elementBounds, rectsIntersect } from "./geometry/bounds.js";
import type { IndexedElement, ReplaceElementsOperation } from "./operations.js";
import type { PaperElement, PaperPage } from "./types.js";

/**
 * One continuous eraser gesture over a page.
 *
 * Accumulates the effect of several sweeps on a working copy (for the preview) and, at the end,
 * produces ONE `REPLACE_ELEMENTS` operation with the correct indices. Pieces created
 * and erased within the same gesture never show up in the operation.
 */
export class EraseSession {
  private working: PaperElement[];
  private touched = false;

  constructor(
    private readonly page: PaperPage,
    private readonly options: EraseOptions,
  ) {
    this.working = page.elements.slice();
  }

  /** Applies a sweep. Returns `true` if anything was erased. */
  sweep(sweep: EraserSweep): boolean {
    const rect = sweepBounds(sweep);
    let changed = false;
    const next: PaperElement[] = [];
    for (const element of this.working) {
      if (element.type !== "stroke" || !rectsIntersect(elementBounds(element), rect)) {
        next.push(element);
        continue;
      }
      const pieces = eraseFromStroke(element, sweep, this.options);
      if (pieces === null) {
        next.push(element);
      } else {
        next.push(...pieces);
        changed = true;
      }
    }
    if (changed) {
      this.working = next;
      this.touched = true;
    }
    return changed;
  }

  /** Page with the current state of the gesture (for the preview). */
  previewPage(): PaperPage {
    return { ...this.page, elements: this.working };
  }

  hasChanges(): boolean {
    return this.touched;
  }

  /** The gesture's single operation, or `null` if nothing changed. */
  toOperation(): ReplaceElementsOperation | null {
    if (!this.touched) return null;
    const originalIds = new Set(this.page.elements.map((e) => e.id));
    const finalIds = new Set(this.working.map((e) => e.id));
    const removed: IndexedElement[] = [];
    this.page.elements.forEach((element, index) => {
      if (!finalIds.has(element.id)) removed.push({ index, element });
    });
    const added: IndexedElement[] = [];
    this.working.forEach((element, index) => {
      if (!originalIds.has(element.id)) added.push({ index, element });
    });
    if (removed.length === 0 && added.length === 0) return null;
    return { type: "REPLACE_ELEMENTS", pageId: this.page.id, removed, added };
  }
}
