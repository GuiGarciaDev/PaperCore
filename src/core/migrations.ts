import { PaperCoreError } from "./errors.js";
import { CURRENT_SCHEMA_VERSION } from "./types.js";

export type RawDocument = Record<string, unknown>;

/** Pure migration from version `v` to `v + 1`. Must not mutate its input. */
export type Migration = (doc: RawDocument) => RawDocument;

/**
 * Migration registry, indexed by the SOURCE version.
 * Future example: `1: (doc) => ({ ...doc, pages: doc.pages.map(addLayers) })` takes v1 → v2.
 */
export const MIGRATIONS: Readonly<Record<number, Migration>> = Object.freeze({});

export interface MigrateOptions {
  migrations?: Readonly<Record<number, Migration>>;
  targetVersion?: number;
}

/**
 * Brings a raw (not yet validated) document up to the target version.
 * Versions newer than the supported one are rejected, never silently accepted.
 */
export function migrateDocument(raw: unknown, options: MigrateOptions = {}): RawDocument {
  const migrations = options.migrations ?? MIGRATIONS;
  const target = options.targetVersion ?? CURRENT_SCHEMA_VERSION;

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new PaperCoreError("INVALID_DOCUMENT", "The document must be an object.");
  }
  let doc = raw as RawDocument;
  const version = doc.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new PaperCoreError("INVALID_DOCUMENT", "Missing or invalid schemaVersion.");
  }
  if (version > target) {
    throw new PaperCoreError(
      "UNSUPPORTED_VERSION",
      `The document uses schema v${version}, newer than the supported one (v${target}). Update PaperCore.`,
    );
  }

  for (let current = version; current < target; current++) {
    const migrate = migrations[current];
    if (!migrate) {
      throw new PaperCoreError(
        "UNSUPPORTED_VERSION",
        `There is no migration from schema v${current} to v${current + 1}.`,
      );
    }
    doc = { ...migrate(doc), schemaVersion: current + 1 };
  }
  return doc;
}
