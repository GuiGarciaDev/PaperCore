import { resolveLimits, type PaperLimits, type PartialLimits } from "./config.js";
import { cloneElementWithNewId, createPage, type CreatePageOptions } from "./document.js";
import { Emitter } from "./emitter.js";
import { PaperCoreError } from "./errors.js";
import { HistoryManager } from "./history.js";
import {
  addedElements,
  applyToElements,
  isEmptyOperation,
  removeElementsOperation,
  type ElementOperation,
} from "./operations.js";
import { ensureValidDocument } from "./serialization.js";
import type { PageBackground, PaperDocument, PaperPage } from "./types.js";
import { validateBackground, validateElement } from "./validation.js";

export type ChangeReason = "user" | "undo" | "redo" | "load";

/** Everything a persistence adapter needs to save per page. */
export interface DocumentChange {
  readonly reason: ChangeReason;
  /** Pages whose content or background changed (includes newly created ones). */
  readonly changedPageIds: readonly string[];
  readonly addedPageIds: readonly string[];
  readonly deletedPageIds: readonly string[];
  readonly orderChanged: boolean;
}

export interface StoreEvents {
  change: DocumentChange;
}

export interface StoreOptions {
  limits?: PartialLimits;
  readOnly?: boolean;
}

/**
 * Owner of the document. Immutable per-page updates: each change creates new page/document
 * objects and shares the elements, so snapshots are cheap and safe.
 */
export class PaperStore {
  readonly limits: PaperLimits;
  private doc: PaperDocument;
  private readOnly: boolean;
  private readonly history: HistoryManager;
  private readonly emitter = new Emitter<StoreEvents>();

  constructor(document: PaperDocument, options: StoreOptions = {}) {
    this.limits = resolveLimits(options.limits);
    this.doc = ensureValidDocument(document, this.limits);
    this.readOnly = options.readOnly ?? false;
    this.history = new HistoryManager(this.limits.maxHistoryPerPage);
  }

  on<K extends keyof StoreEvents>(type: K, listener: (payload: StoreEvents[K]) => void): () => void {
    return this.emitter.on(type, listener);
  }

  getDocument(): PaperDocument {
    return this.doc;
  }

  getPage(pageId: string): PaperPage {
    const page = this.doc.pages.find((p) => p.id === pageId);
    if (!page) throw new PaperCoreError("PAGE_NOT_FOUND", `Page ${pageId} does not exist.`);
    return page;
  }

  hasPage(pageId: string): boolean {
    return this.doc.pages.some((p) => p.id === pageId);
  }

  isReadOnly(): boolean {
    return this.readOnly;
  }

  setReadOnly(readOnly: boolean): void {
    this.readOnly = readOnly;
  }

  canUndo(pageId: string): boolean {
    return !this.readOnly && this.history.canUndo(pageId);
  }

  canRedo(pageId: string): boolean {
    return !this.readOnly && this.history.canRedo(pageId);
  }

  /** Applies a user operation and records it in the page's history. */
  apply(op: ElementOperation): void {
    this.assertWritable();
    if (isEmptyOperation(op)) return;
    const page = this.getPage(op.pageId);
    for (const { element } of addedElements(op)) {
      const result = validateElement(element, page.size, this.limits);
      if (!result.ok) throw new PaperCoreError("INVALID_ARGUMENT", "Invalid element.", result.errors);
    }
    // History is recorded BEFORE the event: "change" listeners already see an up-to-date canUndo.
    this.commit(op, "user", () => this.history.record(op));
  }

  undo(pageId: string): boolean {
    this.assertWritable();
    const op = this.history.undo(pageId);
    if (!op) return false;
    try {
      this.commit(op, "undo");
    } catch (error) {
      this.history.revert(pageId, "undo");
      throw error;
    }
    return true;
  }

  redo(pageId: string): boolean {
    this.assertWritable();
    const op = this.history.redo(pageId);
    if (!op) return false;
    try {
      this.commit(op, "redo");
    } catch (error) {
      this.history.revert(pageId, "redo");
      throw error;
    }
    return true;
  }

  /** Removes every element from the page. Goes into history (can be undone). */
  clearPage(pageId: string): void {
    const page = this.getPage(pageId);
    this.apply(
      removeElementsOperation(
        page,
        page.elements.map((e) => e.id),
      ),
    );
  }

  /** Creates a page. Structural operation: not recorded in history. */
  addPage(options: CreatePageOptions & { index?: number } = {}): PaperPage {
    this.assertWritable();
    if (this.doc.pages.length >= this.limits.maxPages) {
      throw new PaperCoreError("LIMIT_EXCEEDED", `Limit of ${this.limits.maxPages} pages reached.`);
    }
    const page = createPage({
      size: options.size ?? this.doc.defaultPageSize,
      background: options.background,
    });
    if (options.background) this.assertBackground(options.background);
    const pages = this.doc.pages.slice();
    const index = Math.min(Math.max(options.index ?? pages.length, 0), pages.length);
    pages.splice(index, 0, page);
    this.doc = { ...this.doc, pages };
    this.emit({ reason: "user", changedPageIds: [page.id], addedPageIds: [page.id], orderChanged: true });
    return page;
  }

  /** Duplicates the page (with new ids) right after the original. */
  duplicatePage(pageId: string): PaperPage {
    this.assertWritable();
    if (this.doc.pages.length >= this.limits.maxPages) {
      throw new PaperCoreError("LIMIT_EXCEEDED", `Limit of ${this.limits.maxPages} pages reached.`);
    }
    const source = this.getPage(pageId);
    const copy: PaperPage = {
      ...createPage({ size: source.size, background: source.background }),
      elements: source.elements.map(cloneElementWithNewId),
    };
    const pages = this.doc.pages.slice();
    pages.splice(pages.indexOf(source) + 1, 0, copy);
    this.doc = { ...this.doc, pages };
    this.emit({ reason: "user", changedPageIds: [copy.id], addedPageIds: [copy.id], orderChanged: true });
    return copy;
  }

  /** Deletes the page and its history. Never leaves the document without pages. */
  deletePage(pageId: string): void {
    this.assertWritable();
    this.getPage(pageId);
    if (this.doc.pages.length <= 1) {
      throw new PaperCoreError("LAST_PAGE", "The document must have at least one page.");
    }
    this.doc = { ...this.doc, pages: this.doc.pages.filter((p) => p.id !== pageId) };
    this.history.clearPage(pageId);
    this.emit({ reason: "user", deletedPageIds: [pageId], orderChanged: true });
  }

  /** Moves the page to another position. */
  movePage(pageId: string, toIndex: number): void {
    this.assertWritable();
    const page = this.getPage(pageId);
    const pages = this.doc.pages.filter((p) => p.id !== pageId);
    pages.splice(Math.min(Math.max(toIndex, 0), pages.length), 0, page);
    this.doc = { ...this.doc, pages };
    this.emit({ reason: "user", orderChanged: true });
  }

  /** Changes the background without touching the elements. */
  setPageBackground(pageId: string, background: PageBackground): void {
    this.assertWritable();
    const page = this.getPage(pageId);
    const valid = this.assertBackground(background);
    this.replacePage({ ...page, background: valid });
    this.emit({ reason: "user", changedPageIds: [pageId] });
  }

  /** Replaces the whole document (for example, a version loaded from storage). Resets history. */
  load(document: PaperDocument): void {
    const previousIds = this.doc.pages.map((p) => p.id);
    this.doc = ensureValidDocument(document, this.limits);
    this.history.clear();
    const nextIds = this.doc.pages.map((p) => p.id);
    this.emit({
      reason: "load",
      changedPageIds: nextIds,
      addedPageIds: nextIds.filter((id) => !previousIds.includes(id)),
      deletedPageIds: previousIds.filter((id) => !nextIds.includes(id)),
      orderChanged: true,
    });
  }

  destroy(): void {
    this.emitter.clear();
    this.history.clear();
  }

  /** Applies the operation; `beforeEmit` runs after validation and before the "change" event. */
  private commit(op: ElementOperation, reason: ChangeReason, beforeEmit?: () => void): void {
    const page = this.getPage(op.pageId);
    const elements = applyToElements(page.elements, op);
    if (elements.length > this.limits.maxElementsPerPage) {
      throw new PaperCoreError(
        "LIMIT_EXCEEDED",
        `Limit of ${this.limits.maxElementsPerPage} elements per page reached.`,
      );
    }
    this.replacePage({ ...page, elements });
    beforeEmit?.();
    this.emit({ reason, changedPageIds: [op.pageId] });
  }

  private replacePage(next: PaperPage): void {
    this.doc = { ...this.doc, pages: this.doc.pages.map((p) => (p.id === next.id ? next : p)) };
  }

  private assertBackground(background: PageBackground): PageBackground {
    const result = validateBackground(background, this.limits);
    if (!result.ok) throw new PaperCoreError("INVALID_ARGUMENT", "Invalid background.", result.errors);
    return result.value;
  }

  private assertWritable(): void {
    if (this.readOnly) throw new PaperCoreError("READ_ONLY", "The document is in read-only mode.");
  }

  private emit(change: Partial<DocumentChange> & { reason: ChangeReason }): void {
    this.emitter.emit("change", {
      changedPageIds: [],
      addedPageIds: [],
      deletedPageIds: [],
      orderChanged: false,
      ...change,
    });
  }
}
