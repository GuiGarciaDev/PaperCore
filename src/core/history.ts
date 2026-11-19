import { invertOperation, type ElementOperation } from "./operations.js";

interface PageStacks {
  undo: ElementOperation[];
  redo: ElementOperation[];
}

/**
 * Histórico de operações com UMA pilha por página (ADR-0004).
 * Guarda as operações já aplicadas. `undo` devolve a inversa a ser aplicada.
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

  /** Registra uma operação recém-aplicada pelo usuário. Limpa o redo da página. */
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

  /** Retira a última operação e devolve a inversa, que deve ser aplicada ao documento. */
  undo(pageId: string): ElementOperation | undefined {
    const stacks = this.stacks.get(pageId);
    const op = stacks?.undo.pop();
    if (!stacks || !op) return undefined;
    stacks.redo.push(op);
    return invertOperation(op);
  }

  /** Retira a última operação desfeita e a devolve para ser aplicada novamente. */
  redo(pageId: string): ElementOperation | undefined {
    const stacks = this.stacks.get(pageId);
    const op = stacks?.redo.pop();
    if (!stacks || !op) return undefined;
    stacks.undo.push(op);
    return op;
  }

  /** Desfaz o efeito de um `undo`/`redo` que falhou ao ser aplicado. */
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
