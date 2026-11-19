import { createDocument } from "../src/core/document.js";
import type { PaperDocument, StrokeElement } from "../src/core/types.js";

let counter = 0;

export function stroke(overrides: Partial<StrokeElement> = {}): StrokeElement {
  counter += 1;
  return {
    id: `s${counter}`,
    type: "stroke",
    style: { color: "#112233", width: 3 },
    hasPressure: false,
    points: [10, 10, 0.5, 20, 20, 0.5],
    ...overrides,
  };
}

export function docWithStrokes(count: number): PaperDocument {
  const doc = createDocument({ id: "doc1" });
  const page = doc.pages[0]!;
  return {
    ...doc,
    pages: [{ ...page, elements: Array.from({ length: count }, () => stroke()) }],
  };
}
