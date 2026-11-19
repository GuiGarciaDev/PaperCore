import { PaperCoreError } from "./errors.js";
import { CURRENT_SCHEMA_VERSION } from "./types.js";

export type RawDocument = Record<string, unknown>;

/** Migração pura de uma versão `v` para `v + 1`. Não deve mutar a entrada. */
export type Migration = (doc: RawDocument) => RawDocument;

/**
 * Registro de migrações, indexado pela versão de ORIGEM.
 * Exemplo futuro: `1: (doc) => ({ ...doc, pages: doc.pages.map(addLayers) })` leva v1 → v2.
 */
export const MIGRATIONS: Readonly<Record<number, Migration>> = Object.freeze({});

export interface MigrateOptions {
  migrations?: Readonly<Record<number, Migration>>;
  targetVersion?: number;
}

/**
 * Leva um documento bruto (ainda não validado) até a versão alvo.
 * Versões mais novas que a suportada são rejeitadas, nunca aceitas silenciosamente.
 */
export function migrateDocument(raw: unknown, options: MigrateOptions = {}): RawDocument {
  const migrations = options.migrations ?? MIGRATIONS;
  const target = options.targetVersion ?? CURRENT_SCHEMA_VERSION;

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new PaperCoreError("INVALID_DOCUMENT", "O documento precisa ser um objeto.");
  }
  let doc = raw as RawDocument;
  const version = doc.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new PaperCoreError("INVALID_DOCUMENT", "schemaVersion ausente ou inválido.");
  }
  if (version > target) {
    throw new PaperCoreError(
      "UNSUPPORTED_VERSION",
      `O documento usa o schema v${version}, mais novo que o suportado (v${target}). Atualize o PaperCore.`,
    );
  }

  for (let current = version; current < target; current++) {
    const migrate = migrations[current];
    if (!migrate) {
      throw new PaperCoreError(
        "UNSUPPORTED_VERSION",
        `Não há migração do schema v${current} para v${current + 1}.`,
      );
    }
    doc = { ...migrate(doc), schemaVersion: current + 1 };
  }
  return doc;
}
