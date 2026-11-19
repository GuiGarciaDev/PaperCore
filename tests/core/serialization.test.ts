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

describe("serialização", () => {
  it("faz round-trip exato", () => {
    const doc = docWithStrokes(3);
    expect(parseDocument(serializeDocument(doc))).toEqual(doc);
  });

  it("rejeita JSON inválido", () => {
    expect(codeOf(() => parseDocument("{nope"))).toBe("INVALID_JSON");
  });

  it("verifica o tamanho ANTES de fazer o parse", () => {
    const limits = resolveLimits({ maxImportSize: 10 });
    expect(codeOf(() => parseDocument("x".repeat(11), limits))).toBe("IMPORT_TOO_LARGE");
  });

  it("rejeita documento estruturalmente inválido com detalhes", () => {
    try {
      parseDocument(JSON.stringify({ ...docWithStrokes(0), pages: [] }));
      expect.fail("deveria lançar");
    } catch (error) {
      expect(error).toBeInstanceOf(PaperCoreError);
      expect((error as PaperCoreError).code).toBe("INVALID_DOCUMENT");
      expect((error as PaperCoreError).details.length).toBeGreaterThan(0);
    }
  });

  it("rejeita versão mais nova que a suportada", () => {
    const json = JSON.stringify({ ...docWithStrokes(0), schemaVersion: 99 });
    expect(codeOf(() => parseDocument(json))).toBe("UNSUPPORTED_VERSION");
  });
});

describe("migrações", () => {
  it("aplica a cadeia v → v+1 até a versão alvo sem mutar a entrada", () => {
    const toV2: Migration = (doc) => ({ ...doc, renamed: doc.legacy });
    const toV3: Migration = ({ legacy: _legacy, ...rest }) => rest;
    const input = { schemaVersion: 1, legacy: "x" };
    const out = migrateDocument(input, { migrations: { 1: toV2, 2: toV3 }, targetVersion: 3 });
    expect(out).toEqual({ schemaVersion: 3, renamed: "x" });
    expect(input).toEqual({ schemaVersion: 1, legacy: "x" });
  });

  it("falha quando falta um passo da cadeia", () => {
    expect(codeOf(() => migrateDocument({ schemaVersion: 1 }, { migrations: {}, targetVersion: 2 }))).toBe(
      "UNSUPPORTED_VERSION",
    );
  });

  it("rejeita schemaVersion ausente", () => {
    expect(codeOf(() => migrateDocument({}))).toBe("INVALID_DOCUMENT");
  });
});
