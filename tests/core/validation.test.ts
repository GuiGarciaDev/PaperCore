import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS, resolveLimits } from "../../src/core/config.js";
import { createBackground, createDocument } from "../../src/core/document.js";
import { validateDocument } from "../../src/core/validation.js";
import { docWithStrokes, stroke } from "../helpers.js";

const limits = DEFAULT_LIMITS;

function withElement(element: unknown) {
  const doc = docWithStrokes(0);
  return { ...doc, pages: [{ ...doc.pages[0]!, elements: [element] }] };
}

describe("validateDocument", () => {
  it("accepts a freshly created document", () => {
    const result = validateDocument(createDocument(), limits);
    expect(result.ok).toBe(true);
  });

  it("returns a copy that shares no references with the input", () => {
    const input = docWithStrokes(1);
    const result = validateDocument(input, limits);
    if (!result.ok) throw new Error(result.errors.join());
    expect(result.value).toEqual(input);
    expect(result.value).not.toBe(input);
    expect(result.value.pages[0]!.elements[0]).not.toBe(input.pages[0]!.elements[0]);
  });

  it("rejects unknown keys (including __proto__ coming from JSON)", () => {
    const raw = JSON.parse('{"__proto__": {"polluted": true}}');
    const result = validateDocument({ ...createDocument(), ...raw, extra: 1 }, limits);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toContain('unknown field "extra"');
  });

  it("rejects a document without pages", () => {
    const result = validateDocument({ ...createDocument(), pages: [] }, limits);
    expect(result.ok).toBe(false);
  });

  it("rejects a schemaVersion other than the current one", () => {
    const result = validateDocument({ ...createDocument(), schemaVersion: 2 }, limits);
    expect(result.ok).toBe(false);
  });

  it.each([
    ["CSS color format", stroke({ style: { color: "red", width: 3 } })],
    ["color with injection", stroke({ style: { color: '#fff" onload="x', width: 3 } })],
    ["width above the limit", stroke({ style: { color: "#000000", width: 999 } })],
    ["points not in stride 3", stroke({ points: [1, 2] })],
    ["point outside the page", stroke({ points: [-5, 10, 0.5] })],
    ["pressure above 1", stroke({ points: [5, 10, 1.5] })],
    ["NaN", stroke({ points: [Number.NaN, 10, 0.5] })],
    ["unknown type", { ...stroke(), type: "laser" }],
    ["id with invalid characters", stroke({ id: "<script>" })],
  ])("rejects element: %s", (_label, element) => {
    expect(validateDocument(withElement(element), limits).ok).toBe(false);
  });

  it("rejects duplicate ids across pages", () => {
    const doc = createDocument();
    const page = doc.pages[0]!;
    const result = validateDocument({ ...doc, pages: [page, { ...page }] }, limits);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toContain("duplicate id");
  });

  it("applies configurable limits", () => {
    const tight = resolveLimits({ maxElementsPerPage: 2 });
    expect(validateDocument(docWithStrokes(2), tight).ok).toBe(true);
    expect(validateDocument(docWithStrokes(3), tight).ok).toBe(false);
  });

  it("caps the number of errors for badly malformed documents", () => {
    const bad = Array.from({ length: 500 }, () => ({ type: "stroke" }));
    const result = validateDocument(withElement(null), limits);
    expect(result.ok).toBe(false);
    const doc = docWithStrokes(0);
    const many = validateDocument({ ...doc, pages: [{ ...doc.pages[0]!, elements: bad }] }, limits);
    if (!many.ok) expect(many.errors.length).toBeLessThanOrEqual(50);
  });

  it("validates backgrounds and rejects fields from another type", () => {
    const doc = createDocument({ background: createBackground("grid") });
    expect(validateDocument(doc, limits).ok).toBe(true);
    const page = { ...doc.pages[0]!, background: { type: "blank", color: "#ffffff", spacing: 10 } };
    expect(validateDocument({ ...doc, pages: [page] }, limits).ok).toBe(false);
  });
});

describe("resolveLimits", () => {
  it("rejects inconsistent ranges", () => {
    expect(() => resolveLimits({ zoom: { min: 4, max: 1 } })).toThrow();
    expect(() => resolveLimits({ maxPages: 0 })).toThrow();
  });
});
