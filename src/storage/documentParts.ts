import { DEFAULT_LIMITS, type PaperLimits } from "../core/config.js";
import { PaperCoreError } from "../core/errors.js";
import { migrateDocument } from "../core/migrations.js";
import { ensureValidDocument } from "../core/serialization.js";
import type { PaperDocument, PaperPage } from "../core/types.js";
import type { DocumentMeta } from "./types.js";

export function documentMeta(doc: PaperDocument, savedAt = Date.now()): DocumentMeta {
  return {
    id: doc.id,
    schemaVersion: doc.schemaVersion,
    defaultPageSize: doc.defaultPageSize,
    pageIds: doc.pages.map((p) => p.id),
    savedAt,
  };
}

/**
 * Assembles the document from the meta and the stored pages, going through the same migration
 * and strict validation as an import: stored data is untrusted data too.
 */
export function assembleDocument(
  meta: DocumentMeta,
  pagesById: ReadonlyMap<string, unknown>,
  limits: PaperLimits = DEFAULT_LIMITS,
): PaperDocument {
  const missing = meta.pageIds.filter((id) => !pagesById.has(id));
  if (missing.length > 0) {
    throw new PaperCoreError(
      "STORAGE_CORRUPTED",
      `Document ${meta.id} is incomplete in storage.`,
      missing.map((id) => `Missing page: ${id}`),
    );
  }
  const raw = {
    id: meta.id,
    schemaVersion: meta.schemaVersion,
    defaultPageSize: meta.defaultPageSize,
    pages: meta.pageIds.map((id) => pagesById.get(id) as PaperPage),
  };
  try {
    return ensureValidDocument(migrateDocument(raw), limits);
  } catch (error) {
    if (error instanceof PaperCoreError && error.code === "INVALID_DOCUMENT") {
      throw new PaperCoreError("STORAGE_CORRUPTED", `Stored document ${meta.id} is invalid.`, error.details);
    }
    throw error;
  }
}
