import { DEFAULT_LIMITS, type PaperLimits } from "./config.js";
import { PaperCoreError } from "./errors.js";
import { migrateDocument, type MigrateOptions } from "./migrations.js";
import type { PaperDocument } from "./types.js";
import { validateDocument } from "./validation.js";

/** Serializa o documento como JSON. O documento já está quantizado, então o round-trip é exato. */
export function serializeDocument(doc: PaperDocument): string {
  return JSON.stringify(doc);
}

/**
 * Converte JSON (por exemplo, um arquivo importado) em documento confiável:
 * limite de tamanho → JSON.parse → migração → validação estrita.
 */
export function parseDocument(
  json: string,
  limits: PaperLimits = DEFAULT_LIMITS,
  migrateOptions?: MigrateOptions,
): PaperDocument {
  if (json.length > limits.maxImportSize) {
    throw new PaperCoreError(
      "IMPORT_TOO_LARGE",
      `O arquivo tem ${json.length} caracteres, acima do limite de ${limits.maxImportSize}.`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new PaperCoreError("INVALID_JSON", "O conteúdo não é um JSON válido.");
  }
  return ensureValidDocument(migrateDocument(raw, migrateOptions), limits);
}

/** Valida (e normaliza) um documento já em memória, lançando `INVALID_DOCUMENT` se houver problemas. */
export function ensureValidDocument(input: unknown, limits: PaperLimits = DEFAULT_LIMITS): PaperDocument {
  const result = validateDocument(input, limits);
  if (!result.ok) {
    throw new PaperCoreError("INVALID_DOCUMENT", "Documento inválido.", result.errors);
  }
  return result.value;
}
