import type { PaperLimits } from "../core/config.js";
import type { PaperDocument, PaperPage } from "../core/types.js";
import { assembleDocument } from "./documentParts.js";
import type { DocumentMeta, StorageAdapter } from "./types.js";

interface StoredDocument {
  meta: DocumentMeta;
  pages: Map<string, PaperPage>;
}

/**
 * Adaptador em memória: para testes, demonstrações e SSR. Guarda cópias (structuredClone), como
 * um armazenamento real faria, para que mutações acidentais não vazem entre gravação e leitura.
 */
export class MemoryStorageAdapter implements StorageAdapter {
  private readonly docs = new Map<string, StoredDocument>();

  constructor(private readonly limits?: PaperLimits) {}

  async load(documentId: string): Promise<PaperDocument | null> {
    const stored = this.docs.get(documentId);
    if (!stored) return null;
    return assembleDocument(structuredClone(stored.meta), structuredClone(stored.pages), this.limits);
  }

  async savePages(documentId: string, pages: readonly PaperPage[], meta: DocumentMeta): Promise<void> {
    let stored = this.docs.get(documentId);
    if (!stored) {
      stored = { meta, pages: new Map() };
      this.docs.set(documentId, stored);
    }
    for (const page of pages) stored.pages.set(page.id, structuredClone(page));
    stored.meta = structuredClone(meta);
  }

  async deletePages(documentId: string, pageIds: readonly string[]): Promise<void> {
    const stored = this.docs.get(documentId);
    if (!stored) return;
    for (const id of pageIds) stored.pages.delete(id);
  }

  async deleteDocument(documentId: string): Promise<void> {
    this.docs.delete(documentId);
  }

  async list(): Promise<string[]> {
    return [...this.docs.keys()];
  }

  /** Ids das páginas gravadas de um documento (útil em testes). */
  storedPageIds(documentId: string): string[] {
    return [...(this.docs.get(documentId)?.pages.keys() ?? [])];
  }
}
