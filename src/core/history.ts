import { invertOperation, type ElementOperation } from "./operations.js";

interface PageStacks {
  undo: ElementOperation[];
  redo: ElementOperation[];
}

/**
 * Operation history with ONE stack per page.
 * Keeps the operations already applied. `undo` returns the inverse to apply.
 */
export class HistoryManager {
  private readonly stacks = new Map<string, PageStacks>();

  constructor(private readonly limitPerPage: number) {}

  private stacksFor(pageId: string): PageStacks {
    let stacks = this.stacks.get(pageId);
    if (!stacks) {
      stacks = { undo: [], redo: [] };
      this.stacks.set(pageId, stacks);
    }
    return stacks;
  }

  /** Records an operation just applied by the user. Clears the page's redo stack. */
  record(op: ElementOperation): void {
    const stacks = this.stacksFor(op.pageId);
    stacks.undo.push(op);
    stacks.redo.length = 0;
    if (stacks.undo.length > this.limitPerPage) {
      stacks.undo.splice(0, stacks.undo.length - this.limitPerPage);
    }
  }

  canUndo(pageId: string): boolean {
    return (this.stacks.get(pageId)?.undo.length ?? 0) > 0;
  }

  canRedo(pageId: string): boolean {
    return (this.stacks.get(pageId)?.redo.length ?? 0) > 0;
  }

  /** Pops the last operation and returns its inverse, which must be applied to the document. */
  undo(pageId: string): ElementOperation | undefined {
    const stacks = this.stacks.get(pageId);
    const op = stacks?.undo.pop();
    if (!stacks || !op) return undefined;
    stacks.redo.push(op);
    return invertOperation(op);
  }

  /** Pops the last undone operation and returns it to be applied again. */
  redo(pageId: string): ElementOperation | undefined {
    const stacks = this.stacks.get(pageId);
    const op = stacks?.redo.pop();
    if (!stacks || !op) return undefined;
    stacks.undo.push(op);
    return op;
  }

  /** Reverts the effect of an `undo`/`redo` that failed to apply. */
  revert(pageId: string, direction: "undo" | "redo"): void {
    const stacks = this.stacks.get(pageId);
    if (!stacks) return;
    if (direction === "undo") {
      const op = stacks.redo.pop();
      if (op) stacks.undo.push(op);
    } else {
      const op = stacks.undo.pop();
      if (op) stacks.redo.push(op);
    }
  }

  clearPage(pageId: string): void {
    this.stacks.delete(pageId);
  }

  clear(): void {
    this.stacks.clear();
  }

  size(pageId: string): { undo: number; redo: number } {
    const stacks = this.stacks.get(pageId);
    return { undo: stacks?.undo.length ?? 0, redo: stacks?.redo.length ?? 0 };
  }
}
