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
  /** Database name. Default: `"papercore"`. */
  databaseName?: string;
  limits?: PaperLimits;
  /** IndexedDB factory (tests use `fake-indexeddb`). Default: `globalThis.indexedDB`. */
  indexedDB?: IDBFactory;
}

/**
 * IndexedDB adapter. Two object stores:
 * - `documents` (key `id`): each document's meta;
 * - `pages` (key `[documentId, pageId]`, index `byDocument`): one entry per page.
 *
 * `savePages` writes pages and meta in the SAME transaction: either everything is written, or nothing.
 * The database is only opened on first use, so importing this module during SSR is safe.
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

  /** Closes the connection (another tab may need to upgrade the database). It can be reopened later. */
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
        new PaperCoreError("STORAGE_UNAVAILABLE", "IndexedDB is not available in this environment."),
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
        // Another tab wants to upgrade the schema: release the connection instead of blocking it.
        db.onversionchange = () => {
          db.close();
          this.dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(storageError("Could not open IndexedDB.", req.error));
      req.onblocked = () =>
        reject(new PaperCoreError("STORAGE_UNAVAILABLE", "IndexedDB is blocked by another tab."));
    });
  }
}

function request<T>(req: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(storageError("Failed to read from IndexedDB.", req.error));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(storageError("Failed to write to IndexedDB.", tx.error));
    tx.onabort = () => reject(storageError("The IndexedDB write was aborted.", tx.error));
  });
}

function storageError(message: string, cause: DOMException | null): PaperCoreError {
  // QuotaExceededError: the browser refused because it ran out of space.
  if (cause?.name === "QuotaExceededError") {
    return new PaperCoreError("STORAGE_QUOTA_EXCEEDED", "The browser is out of storage space.");
  }
  return new PaperCoreError("STORAGE_ERROR", message, cause ? [`${cause.name}: ${cause.message}`] : []);
}
