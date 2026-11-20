import { DEFAULT_LIMITS, type PaperLimits } from "./config.js";
import { PaperCoreError } from "./errors.js";
import { migrateDocument, type MigrateOptions } from "./migrations.js";
import type { PaperDocument } from "./types.js";
import { validateDocument } from "./validation.js";

/** Serializes the document as JSON. The document is already quantized, so the round-trip is exact. */
export function serializeDocument(doc: PaperDocument): string {
  return JSON.stringify(doc);
}

/**
 * Turns JSON (for example, an imported file) into a trusted document:
 * size limit → JSON.parse → migration → strict validation.
 */
export function parseDocument(
  json: string,
  limits: PaperLimits = DEFAULT_LIMITS,
  migrateOptions?: MigrateOptions,
): PaperDocument {
  if (json.length > limits.maxImportSize) {
    throw new PaperCoreError(
      "IMPORT_TOO_LARGE",
      `The file has ${json.length} characters, above the limit of ${limits.maxImportSize}.`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new PaperCoreError("INVALID_JSON", "The content is not valid JSON.");
  }
  return ensureValidDocument(migrateDocument(raw, migrateOptions), limits);
}

/** Validates (and normalizes) a document already in memory, throwing `INVALID_DOCUMENT` on problems. */
export function ensureValidDocument(input: unknown, limits: PaperLimits = DEFAULT_LIMITS): PaperDocument {
  const result = validateDocument(input, limits);
  if (!result.ok) {
    throw new PaperCoreError("INVALID_DOCUMENT", "Invalid document.", result.errors);
  }
  return result.value;
}
