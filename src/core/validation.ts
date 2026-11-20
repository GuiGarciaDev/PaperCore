import { HEX_COLOR_PATTERN, ID_PATTERN, POINT_STRIDE, type PaperLimits, type Range } from "./config.js";
import {
  CURRENT_SCHEMA_VERSION,
  type PageBackground,
  type PaperDocument,
  type PaperElement,
  type PaperPage,
  type Size,
} from "./types.js";

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** Avoids huge error lists for badly malformed documents. */
const MAX_ERRORS = 50;

class Collector {
  readonly errors: string[] = [];
  add(message: string): void {
    if (this.errors.length < MAX_ERRORS) this.errors.push(message);
  }
  get full(): boolean {
    return this.errors.length >= MAX_ERRORS;
  }
}

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkKeys(value: Obj, allowed: readonly string[], path: string, c: Collector): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) c.add(`${path}: unknown field "${key}"`);
  }
}

function readId(value: unknown, path: string, c: Collector): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    c.add(`${path}: invalid id (expected [A-Za-z0-9_-], 1 to 64 characters)`);
    return "";
  }
  return value;
}

function readColor(value: unknown, path: string, c: Collector): string {
  if (typeof value !== "string" || !HEX_COLOR_PATTERN.test(value)) {
    c.add(`${path}: invalid color (expected #rrggbb)`);
    return "#000000";
  }
  return value.toLowerCase();
}

function readNumber(value: unknown, range: Range, path: string, c: Collector): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    c.add(`${path}: invalid number`);
    return range.min;
  }
  if (value < range.min || value > range.max) {
    c.add(`${path}: ${value} out of range [${range.min}, ${range.max}]`);
  }
  return value;
}

function readSize(value: unknown, limits: PaperLimits, path: string, c: Collector): Size {
  if (!isObject(value)) {
    c.add(`${path}: missing size`);
    return { width: limits.pageSize.min, height: limits.pageSize.min };
  }
  checkKeys(value, ["width", "height"], path, c);
  return {
    width: readNumber(value.width, limits.pageSize, `${path}.width`, c),
    height: readNumber(value.height, limits.pageSize, `${path}.height`, c),
  };
}

function readBackground(value: unknown, limits: PaperLimits, path: string, c: Collector): PageBackground {
  if (!isObject(value)) {
    c.add(`${path}: missing background`);
    return { type: "blank", color: "#ffffff" };
  }
  if (value.type === "blank") {
    checkKeys(value, ["type", "color"], path, c);
    return { type: "blank", color: readColor(value.color, `${path}.color`, c) };
  }
  if (value.type === "ruled" || value.type === "grid") {
    checkKeys(value, ["type", "color", "lineColor", "spacing", "lineWidth"], path, c);
    return {
      type: value.type,
      color: readColor(value.color, `${path}.color`, c),
      lineColor: readColor(value.lineColor, `${path}.lineColor`, c),
      spacing: readNumber(value.spacing, limits.backgroundSpacing, `${path}.spacing`, c),
      lineWidth: readNumber(value.lineWidth, limits.backgroundLineWidth, `${path}.lineWidth`, c),
    };
  }
  c.add(`${path}.type: unknown background type`);
  return { type: "blank", color: "#ffffff" };
}

function readPoints(value: unknown, size: Size, limits: PaperLimits, path: string, c: Collector): number[] {
  if (!Array.isArray(value)) {
    c.add(`${path}: expected an array of numbers`);
    return [];
  }
  if (value.length === 0 || value.length % POINT_STRIDE !== 0) {
    c.add(`${path}: length must be a multiple of ${POINT_STRIDE} and greater than zero`);
    return [];
  }
  if (value.length / POINT_STRIDE > limits.maxPointsPerStroke) {
    c.add(`${path}: more than ${limits.maxPointsPerStroke} points`);
    return [];
  }
  const out = new Array<number>(value.length);
  for (let i = 0; i < value.length; i += POINT_STRIDE) {
    const x: unknown = value[i];
    const y: unknown = value[i + 1];
    const p: unknown = value[i + 2];
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof p !== "number" ||
      !(x >= 0 && x <= size.width) ||
      !(y >= 0 && y <= size.height) ||
      !(p >= 0 && p <= 1)
    ) {
      c.add(`${path}[${i}]: invalid point or outside the page`);
      return [];
    }
    out[i] = x;
    out[i + 1] = y;
    out[i + 2] = p;
  }
  return out;
}

function readElement(
  value: unknown,
  size: Size,
  limits: PaperLimits,
  path: string,
  c: Collector,
): PaperElement | null {
  if (!isObject(value)) {
    c.add(`${path}: invalid element`);
    return null;
  }
  if (value.type !== "stroke") {
    c.add(`${path}.type: unknown element type "${String(value.type)}"`);
    return null;
  }
  checkKeys(value, ["id", "type", "style", "hasPressure", "points"], path, c);
  const style = value.style;
  let color = "#000000";
  let width = limits.penWidth.min;
  if (isObject(style)) {
    checkKeys(style, ["color", "width"], `${path}.style`, c);
    color = readColor(style.color, `${path}.style.color`, c);
    width = readNumber(style.width, limits.penWidth, `${path}.style.width`, c);
  } else {
    c.add(`${path}.style: missing`);
  }
  if (typeof value.hasPressure !== "boolean") c.add(`${path}.hasPressure: expected a boolean`);
  return {
    id: readId(value.id, `${path}.id`, c),
    type: "stroke",
    style: { color, width },
    hasPressure: value.hasPressure === true,
    points: readPoints(value.points, size, limits, `${path}.points`, c),
  };
}

function readPage(value: unknown, limits: PaperLimits, path: string, c: Collector): PaperPage | null {
  if (!isObject(value)) {
    c.add(`${path}: invalid page`);
    return null;
  }
  checkKeys(value, ["id", "size", "background", "elements"], path, c);
  const size = readSize(value.size, limits, `${path}.size`, c);
  const elements: PaperElement[] = [];
  if (!Array.isArray(value.elements)) {
    c.add(`${path}.elements: expected an array`);
  } else if (value.elements.length > limits.maxElementsPerPage) {
    c.add(`${path}.elements: more than ${limits.maxElementsPerPage} elements`);
  } else {
    for (let i = 0; i < value.elements.length && !c.full; i++) {
      const element = readElement(value.elements[i], size, limits, `${path}.elements[${i}]`, c);
      if (element) elements.push(element);
    }
  }
  return {
    id: readId(value.id, `${path}.id`, c),
    size,
    background: readBackground(value.background, limits, `${path}.background`, c),
    elements,
  };
}

/**
 * Validates a document strictly and returns a normalized COPY, built only from known fields.
 * Nothing from the input object is reused by reference.
 */
export function validateDocument(input: unknown, limits: PaperLimits): ValidationResult<PaperDocument> {
  const c = new Collector();
  if (!isObject(input)) return { ok: false, errors: ["document: expected an object"] };

  checkKeys(input, ["id", "schemaVersion", "defaultPageSize", "pages"], "document", c);
  if (input.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    c.add(`document.schemaVersion: expected ${CURRENT_SCHEMA_VERSION} (migrate before validating)`);
  }
  const id = readId(input.id, "document.id", c);
  const defaultPageSize = readSize(input.defaultPageSize, limits, "document.defaultPageSize", c);

  const pages: PaperPage[] = [];
  if (!Array.isArray(input.pages) || input.pages.length === 0) {
    c.add("document.pages: the document needs at least one page");
  } else if (input.pages.length > limits.maxPages) {
    c.add(`document.pages: more than ${limits.maxPages} pages`);
  } else {
    for (let i = 0; i < input.pages.length && !c.full; i++) {
      const page = readPage(input.pages[i], limits, `pages[${i}]`, c);
      if (page) pages.push(page);
    }
  }

  const seen = new Set<string>();
  const checkUnique = (value: string, path: string) => {
    if (!value) return;
    if (seen.has(value)) c.add(`${path}: duplicate id "${value}"`);
    seen.add(value);
  };
  checkUnique(id, "document.id");
  pages.forEach((page, p) => {
    checkUnique(page.id, `pages[${p}].id`);
    page.elements.forEach((element, e) => checkUnique(element.id, `pages[${p}].elements[${e}].id`));
  });

  if (c.errors.length > 0) return { ok: false, errors: c.errors };
  return { ok: true, value: { id, schemaVersion: CURRENT_SCHEMA_VERSION, defaultPageSize, pages } };
}

/** Validates a single element against the page size. */
export function validateElement(
  input: unknown,
  pageSize: Size,
  limits: PaperLimits,
): ValidationResult<PaperElement> {
  const c = new Collector();
  const element = readElement(input, pageSize, limits, "element", c);
  if (!element || c.errors.length > 0) return { ok: false, errors: c.errors };
  return { ok: true, value: element };
}

/** Validates a page background. */
export function validateBackground(input: unknown, limits: PaperLimits): ValidationResult<PageBackground> {
  const c = new Collector();
  const background = readBackground(input, limits, "background", c);
  if (c.errors.length > 0) return { ok: false, errors: c.errors };
  return { ok: true, value: background };
}
