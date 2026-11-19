import type { PaperLimits } from "../core/config.js";
import { PaperCoreError } from "../core/errors.js";
import type { PaperDocument, PaperPage } from "../core/types.js";
import { assembleDocument } from "./documentParts.js";
import type { DocumentMeta, StorageAdapter } from "./types.js";

const DB_VERSION = 1;
const DOCUMENTS = "documents";
const PAGES = "pages";
const BY_DOCUMENT = "byDocument";

interface PageRecord {
  documentId: string;
  pageId: string;
  page: PaperPage;
}

export interface IndexedDbAdapterOptions {
  /** Nome do banco. Padrão: `"papercore"`. */
  databaseName?: string;
  limits?: PaperLimits;
  /** Fábrica do IndexedDB (testes usam `fake-indexeddb`). Padrão: `globalThis.indexedDB`. */
  indexedDB?: IDBFactory;
}

/**
 * Adaptador IndexedDB. Duas object stores:
 * - `documents` (chave `id`): a meta de cada documento;
 * - `pages` (chave `[documentId, pageId]`, índice `byDocument`): uma entrada por página.
 *
 * `savePages` grava páginas e meta na MESMA transação: ou tudo é gravado, ou nada.
 * O banco só é aberto no primeiro uso, então importar este módulo em SSR é seguro.
 */
export class IndexedDbStorageAdapter implements StorageAdapter {
  private readonly name: string;
  private readonly factory: IDBFactory | undefined;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly options: IndexedDbAdapterOptions = {}) {
    this.name = options.databaseName ?? "papercore";
    this.factory = options.indexedDB ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  }

  async load(documentId: string): Promise<PaperDocument | null> {
    const db = await this.db();
    const tx = db.transaction([DOCUMENTS, PAGES], "readonly");
    const [meta, records] = await Promise.all([
      request<DocumentMeta | undefined>(tx.objectStore(DOCUMENTS).get(documentId)),
      request<PageRecord[]>(tx.objectStore(PAGES).index(BY_DOCUMENT).getAll(documentId)),
    ]);
    if (!meta) return null;
    const pages = new Map(records.map((r) => [r.pageId, r.page as unknown]));
    return assembleDocument(meta, pages, this.options.limits);
  }

  async savePages(documentId: string, pages: readonly PaperPage[], meta: DocumentMeta): Promise<void> {
    const db = await this.db();
    const tx = db.transaction([DOCUMENTS, PAGES], "readwrite");
    const pageStore = tx.objectStore(PAGES);
    for (const page of pages) pageStore.put({ documentId, pageId: page.id, page } satisfies PageRecord);
    tx.objectStore(DOCUMENTS).put(meta);
    await done(tx);
  }

  async deletePages(documentId: string, pageIds: readonly string[]): Promise<void> {
    if (pageIds.length === 0) return;
    const db = await this.db();
    const tx = db.transaction(PAGES, "readwrite");
    const store = tx.objectStore(PAGES);
    for (const id of pageIds) store.delete([documentId, id]);
    await done(tx);
  }

  async deleteDocument(documentId: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction([DOCUMENTS, PAGES], "readwrite");
    tx.objectStore(DOCUMENTS).delete(documentId);
    const pages = tx.objectStore(PAGES);
    const keys = await request<IDBValidKey[]>(pages.index(BY_DOCUMENT).getAllKeys(documentId));
    for (const key of keys) pages.delete(key);
    await done(tx);
  }

  async list(): Promise<string[]> {
    const db = await this.db();
    const tx = db.transaction(DOCUMENTS, "readonly");
    const keys = await request<IDBValidKey[]>(tx.objectStore(DOCUMENTS).getAllKeys());
    return keys.map(String);
  }

  /** Fecha a conexão (outra aba pode precisar atualizar o banco). Pode ser reaberta depois. */
  close(): void {
    const pending = this.dbPromise;
    this.dbPromise = null;
    void pending?.then((db) => db.close()).catch(() => undefined);
  }

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = this.open().catch((error: unknown) => {
        this.dbPromise = null; // permite tentar de novo
        throw error;
      });
    }
    return this.dbPromise;
  }

  private open(): Promise<IDBDatabase> {
    const factory = this.factory;
    if (!factory) {
      return Promise.reject(
        new PaperCoreError("STORAGE_UNAVAILABLE", "IndexedDB não está disponível neste ambiente."),
      );
    }
    return new Promise((resolve, reject) => {
      const req = factory.open(this.name, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DOCUMENTS)) db.createObjectStore(DOCUMENTS, { keyPath: "id" });
        if (!db.objectStoreNames.contains(PAGES)) {
          const pages = db.createObjectStore(PAGES, { keyPath: ["documentId", "pageId"] });
          pages.createIndex(BY_DOCUMENT, "documentId");
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // Outra aba quer atualizar o esquema: libera a conexão em vez de bloqueá-la.
        db.onversionchange = () => {
          db.close();
          this.dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(storageError("Não foi possível abrir o IndexedDB.", req.error));
      req.onblocked = () =>
        reject(new PaperCoreError("STORAGE_UNAVAILABLE", "O IndexedDB está bloqueado por outra aba."));
    });
  }
}

function request<T>(req: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(storageError("Falha ao ler do IndexedDB.", req.error));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(storageError("Falha ao gravar no IndexedDB.", tx.error));
    tx.onabort = () => reject(storageError("A gravação no IndexedDB foi abortada.", tx.error));
  });
}

function storageError(message: string, cause: DOMException | null): PaperCoreError {
  // QuotaExceededError: o navegador recusou por falta de espaço.
  if (cause?.name === "QuotaExceededError") {
    return new PaperCoreError("STORAGE_QUOTA_EXCEEDED", "Sem espaço de armazenamento no navegador.");
  }
  return new PaperCoreError("STORAGE_ERROR", message, cause ? [`${cause.name}: ${cause.message}`] : []);
}
