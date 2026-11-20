import { describe, expect, it } from "vitest";
import { resolveLimits } from "../../src/core/config.js";
import { PaperCoreError } from "../../src/core/errors.js";
import { migrateDocument, type Migration } from "../../src/core/migrations.js";
import { parseDocument, serializeDocument } from "../../src/core/serialization.js";
import { docWithStrokes } from "../helpers.js";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof PaperCoreError ? error.code : "OTHER";
  }
  return undefined;
}

describe("serialization", () => {
  it("round-trips exactly", () => {
    const doc = docWithStrokes(3);
    expect(parseDocument(serializeDocument(doc))).toEqual(doc);
  });

  it("rejects invalid JSON", () => {
    expect(codeOf(() => parseDocument("{nope"))).toBe("INVALID_JSON");
  });

  it("checks the size BEFORE parsing", () => {
    const limits = resolveLimits({ maxImportSize: 10 });
    expect(codeOf(() => parseDocument("x".repeat(11), limits))).toBe("IMPORT_TOO_LARGE");
  });

  it("rejects a structurally invalid document with details", () => {
    try {
      parseDocument(JSON.stringify({ ...docWithStrokes(0), pages: [] }));
      expect.fail("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(PaperCoreError);
      expect((error as PaperCoreError).code).toBe("INVALID_DOCUMENT");
      expect((error as PaperCoreError).details.length).toBeGreaterThan(0);
    }
  });

  it("rejects a version newer than the supported one", () => {
    const json = JSON.stringify({ ...docWithStrokes(0), schemaVersion: 99 });
    expect(codeOf(() => parseDocument(json))).toBe("UNSUPPORTED_VERSION");
  });
});

describe("migrations", () => {
  it("applies the v → v+1 chain up to the target version without mutating the input", () => {
    const toV2: Migration = (doc) => ({ ...doc, renamed: doc.legacy });
    const toV3: Migration = ({ legacy: _legacy, ...rest }) => rest;
    const input = { schemaVersion: 1, legacy: "x" };
    const out = migrateDocument(input, { migrations: { 1: toV2, 2: toV3 }, targetVersion: 3 });
    expect(out).toEqual({ schemaVersion: 3, renamed: "x" });
    expect(input).toEqual({ schemaVersion: 1, legacy: "x" });
  });

  it("fails when a step of the chain is missing", () => {
    expect(codeOf(() => migrateDocument({ schemaVersion: 1 }, { migrations: {}, targetVersion: 2 }))).toBe(
      "UNSUPPORTED_VERSION",
    );
  });

  it("rejects a missing schemaVersion", () => {
    expect(codeOf(() => migrateDocument({}))).toBe("INVALID_DOCUMENT");
  });
});
