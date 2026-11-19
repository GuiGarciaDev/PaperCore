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

/** Tudo o que um adaptador de persistência precisa para salvar por página. */
export interface DocumentChange {
  readonly reason: ChangeReason;
  /** Páginas cujo conteúdo ou fundo mudou (inclui as recém-criadas). */
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
 * Dono do documento. Atualizações imutáveis por página: cada mudança gera novos objetos de
 * página/documento e compartilha os elementos, então snapshots são baratos e seguros.
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
    if (!page) throw new PaperCoreError("PAGE_NOT_FOUND", `Página ${pageId} não existe.`);
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

  /** Aplica uma operação do usuário e a registra no histórico da página. */
  apply(op: ElementOperation): void {
    this.assertWritable();
    if (isEmptyOperation(op)) return;
    const page = this.getPage(op.pageId);
    for (const { element } of addedElements(op)) {
      const result = validateElement(element, page.size, this.limits);
      if (!result.ok) throw new PaperCoreError("INVALID_ARGUMENT", "Elemento inválido.", result.errors);
    }
    // O histórico é gravado ANTES do evento: quem ouve "change" já vê canUndo atualizado.
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

  /** Remove todos os elementos da página. Entra no histórico (pode ser desfeito). */
  clearPage(pageId: string): void {
    const page = this.getPage(pageId);
    this.apply(
      removeElementsOperation(
        page,
        page.elements.map((e) => e.id),
      ),
    );
  }

  /** Cria uma página. Operação estrutural: não entra no histórico (ADR-0004). */
  addPage(options: CreatePageOptions & { index?: number } = {}): PaperPage {
    this.assertWritable();
    if (this.doc.pages.length >= this.limits.maxPages) {
      throw new PaperCoreError("LIMIT_EXCEEDED", `Limite de ${this.limits.maxPages} páginas atingido.`);
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

  /** Duplica a página (com novos ids) logo depois da original. */
  duplicatePage(pageId: string): PaperPage {
    this.assertWritable();
    if (this.doc.pages.length >= this.limits.maxPages) {
      throw new PaperCoreError("LIMIT_EXCEEDED", `Limite de ${this.limits.maxPages} páginas atingido.`);
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

  /** Exclui a página e o histórico dela. Nunca deixa o documento sem páginas. */
  deletePage(pageId: string): void {
    this.assertWritable();
    this.getPage(pageId);
    if (this.doc.pages.length <= 1) {
      throw new PaperCoreError("LAST_PAGE", "O documento precisa ter pelo menos uma página.");
    }
    this.doc = { ...this.doc, pages: this.doc.pages.filter((p) => p.id !== pageId) };
    this.history.clearPage(pageId);
    this.emit({ reason: "user", deletedPageIds: [pageId], orderChanged: true });
  }

  /** Move a página para outra posição. */
  movePage(pageId: string, toIndex: number): void {
    this.assertWritable();
    const page = this.getPage(pageId);
    const pages = this.doc.pages.filter((p) => p.id !== pageId);
    pages.splice(Math.min(Math.max(toIndex, 0), pages.length), 0, page);
    this.doc = { ...this.doc, pages };
    this.emit({ reason: "user", orderChanged: true });
  }

  /** Troca o fundo sem tocar nos elementos. */
  setPageBackground(pageId: string, background: PageBackground): void {
    this.assertWritable();
    const page = this.getPage(pageId);
    const valid = this.assertBackground(background);
    this.replacePage({ ...page, background: valid });
    this.emit({ reason: "user", changedPageIds: [pageId] });
  }

  /** Substitui o documento inteiro (por exemplo, a versão vinda do servidor). Reinicia o histórico. */
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

  /** Aplica a operação; `beforeEmit` roda depois da validação e antes do evento "change". */
  private commit(op: ElementOperation, reason: ChangeReason, beforeEmit?: () => void): void {
    const page = this.getPage(op.pageId);
    const elements = applyToElements(page.elements, op);
    if (elements.length > this.limits.maxElementsPerPage) {
      throw new PaperCoreError(
        "LIMIT_EXCEEDED",
        `Limite de ${this.limits.maxElementsPerPage} elementos por página atingido.`,
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
    if (!result.ok) throw new PaperCoreError("INVALID_ARGUMENT", "Fundo inválido.", result.errors);
    return result.value;
  }

  private assertWritable(): void {
    if (this.readOnly) throw new PaperCoreError("READ_ONLY", "O documento está em modo somente leitura.");
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
