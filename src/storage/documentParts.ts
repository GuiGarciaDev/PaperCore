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
 * Monta o documento a partir da meta e das páginas gravadas, passando pela mesma migração e
 * validação estrita de uma importação: dado gravado também é dado não confiável.
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
      `O documento ${meta.id} está incompleto no armazenamento.`,
      missing.map((id) => `Página ausente: ${id}`),
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
      throw new PaperCoreError(
        "STORAGE_CORRUPTED",
        `O documento ${meta.id} gravado é inválido.`,
        error.details,
      );
    }
    throw error;
  }
}
