import type { PaperDocument, PaperPage, Size } from "../core/types.js";

/**
 * Document data that does not belong to any page. `pageIds` is the source of truth for the
 * order and for which pages exist: stored pages that are not listed there are ignored when
 * loading (for example, if the app closed between `savePages` and `deletePages`).
 */
export interface DocumentMeta {
  readonly id: string;
  readonly schemaVersion: number;
  readonly defaultPageSize: Size;
  readonly pageIds: readonly string[];
  /** `Date.now()` of the last save. */
  readonly savedAt: number;
}

/**
 * Where documents are stored. The engine saves per page: an app can implement its
 * own adapter (for example, one that writes locally and queues uploads to a server).
 *
 * Contract:
 * - `savePages` writes the given pages **and** the meta, preferably atomically.
 * - `load` returns the document assembled in `meta.pageIds` order, or `null` if it does not exist.
 *   It may throw `PaperCoreError` (`STORAGE_CORRUPTED`) if a listed page is missing.
 */
export interface StorageAdapter {
  load(documentId: string): Promise<PaperDocument | null>;
  savePages(documentId: string, pages: readonly PaperPage[], meta: DocumentMeta): Promise<void>;
  deletePages(documentId: string, pageIds: readonly string[]): Promise<void>;
  deleteDocument(documentId: string): Promise<void>;
  /** Ids of the stored documents. */
  list(): Promise<string[]>;
}
