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
  it("aceita um documento recém-criado", () => {
    const result = validateDocument(createDocument(), limits);
    expect(result.ok).toBe(true);
  });

  it("devolve uma cópia, sem compartilhar referências com a entrada", () => {
    const input = docWithStrokes(1);
    const result = validateDocument(input, limits);
    if (!result.ok) throw new Error(result.errors.join());
    expect(result.value).toEqual(input);
    expect(result.value).not.toBe(input);
    expect(result.value.pages[0]!.elements[0]).not.toBe(input.pages[0]!.elements[0]);
  });

  it("rejeita chaves desconhecidas (inclusive __proto__ vindo de JSON)", () => {
    const raw = JSON.parse('{"__proto__": {"polluted": true}}');
    const result = validateDocument({ ...createDocument(), ...raw, extra: 1 }, limits);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toContain('campo desconhecido "extra"');
  });

  it("rejeita documento sem páginas", () => {
    const result = validateDocument({ ...createDocument(), pages: [] }, limits);
    expect(result.ok).toBe(false);
  });

  it("rejeita schemaVersion diferente da atual", () => {
    const result = validateDocument({ ...createDocument(), schemaVersion: 2 }, limits);
    expect(result.ok).toBe(false);
  });

  it.each([
    ["cor em formato CSS", stroke({ style: { color: "red", width: 3 } })],
    ["cor com injeção", stroke({ style: { color: '#fff" onload="x', width: 3 } })],
    ["espessura acima do limite", stroke({ style: { color: "#000000", width: 999 } })],
    ["pontos fora do passo 3", stroke({ points: [1, 2] })],
    ["ponto fora da página", stroke({ points: [-5, 10, 0.5] })],
    ["pressão acima de 1", stroke({ points: [5, 10, 1.5] })],
    ["NaN", stroke({ points: [Number.NaN, 10, 0.5] })],
    ["tipo desconhecido", { ...stroke(), type: "laser" }],
    ["id com caracteres inválidos", stroke({ id: "<script>" })],
  ])("rejeita elemento: %s", (_label, element) => {
    expect(validateDocument(withElement(element), limits).ok).toBe(false);
  });

  it("rejeita ids duplicados entre páginas", () => {
    const doc = createDocument();
    const page = doc.pages[0]!;
    const result = validateDocument({ ...doc, pages: [page, { ...page }] }, limits);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toContain("id duplicado");
  });

  it("aplica limites configuráveis", () => {
    const tight = resolveLimits({ maxElementsPerPage: 2 });
    expect(validateDocument(docWithStrokes(2), tight).ok).toBe(true);
    expect(validateDocument(docWithStrokes(3), tight).ok).toBe(false);
  });

  it("limita a quantidade de erros em documentos muito malformados", () => {
    const bad = Array.from({ length: 500 }, () => ({ type: "stroke" }));
    const result = validateDocument(withElement(null), limits);
    expect(result.ok).toBe(false);
    const doc = docWithStrokes(0);
    const many = validateDocument({ ...doc, pages: [{ ...doc.pages[0]!, elements: bad }] }, limits);
    if (!many.ok) expect(many.errors.length).toBeLessThanOrEqual(50);
  });

  it("valida fundos e não permite campos de outro tipo", () => {
    const doc = createDocument({ background: createBackground("grid") });
    expect(validateDocument(doc, limits).ok).toBe(true);
    const page = { ...doc.pages[0]!, background: { type: "blank", color: "#ffffff", spacing: 10 } };
    expect(validateDocument({ ...doc, pages: [page] }, limits).ok).toBe(false);
  });
});

describe("resolveLimits", () => {
  it("rejeita intervalos inconsistentes", () => {
    expect(() => resolveLimits({ zoom: { min: 4, max: 1 } })).toThrow();
    expect(() => resolveLimits({ maxPages: 0 })).toThrow();
  });
});
