import { eraseFromStroke, sweepBounds, type EraseOptions, type EraserSweep } from "./geometry/erase.js";
import { elementBounds, rectsIntersect } from "./geometry/bounds.js";
import type { IndexedElement, ReplaceElementsOperation } from "./operations.js";
import type { PaperElement, PaperPage } from "./types.js";

/**
 * Um gesto contínuo de borracha sobre uma página.
 *
 * Acumula o efeito de várias passadas sobre uma cópia de trabalho (para a pré-visualização) e,
 * no fim, produz UMA operação `REPLACE_ELEMENTS` com os índices corretos (ADR-0004). Pedaços
 * criados e apagados no mesmo gesto nunca aparecem na operação.
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

  /** Aplica uma passada. Devolve `true` se algo foi apagado. */
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

  /** Página com o estado atual do gesto (para a pré-visualização). */
  previewPage(): PaperPage {
    return { ...this.page, elements: this.working };
  }

  hasChanges(): boolean {
    return this.touched;
  }

  /** Operação única do gesto, ou `null` se nada mudou. */
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
