import { DEFAULT_BACKGROUNDS, DEFAULT_PAGE_SIZE } from "./config.js";
import { createId } from "./ids.js";
import {
  CURRENT_SCHEMA_VERSION,
  type BackgroundType,
  type PageBackground,
  type PaperDocument,
  type PaperElement,
  type PaperPage,
  type Size,
} from "./types.js";

export interface BackgroundOverrides {
  color?: string;
  lineColor?: string;
  spacing?: number;
  lineWidth?: number;
}

/**
 * Cria um fundo com os valores padrão do tipo, aplicando sobrescritas opcionais.
 * Só copia os campos que o tipo possui (um fundo "blank" nunca recebe `lineColor`).
 */
export function createBackground(type: BackgroundType, overrides: BackgroundOverrides = {}): PageBackground {
  const base = DEFAULT_BACKGROUNDS[type];
  if (base.type === "blank") {
    return { type: "blank", color: overrides.color ?? base.color };
  }
  return {
    type: base.type,
    color: overrides.color ?? base.color,
    lineColor: overrides.lineColor ?? base.lineColor,
    spacing: overrides.spacing ?? base.spacing,
    lineWidth: overrides.lineWidth ?? base.lineWidth,
  };
}

export interface CreatePageOptions {
  size?: Size;
  background?: PageBackground;
}

export function createPage(options: CreatePageOptions = {}): PaperPage {
  return {
    id: createId(),
    size: { ...(options.size ?? DEFAULT_PAGE_SIZE) },
    background: { ...(options.background ?? DEFAULT_BACKGROUNDS.ruled) },
    elements: [],
  };
}

export interface CreateDocumentOptions {
  id?: string;
  pageSize?: Size;
  background?: PageBackground;
}

/** Cria um documento válido com uma página. */
export function createDocument(options: CreateDocumentOptions = {}): PaperDocument {
  const pageSize = { ...(options.pageSize ?? DEFAULT_PAGE_SIZE) };
  return {
    id: options.id ?? createId(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    defaultPageSize: pageSize,
    pages: [createPage({ size: pageSize, background: options.background })],
  };
}

/** Copia um elemento com um novo id (usado ao duplicar páginas). */
export function cloneElementWithNewId(element: PaperElement): PaperElement {
  return { ...element, id: createId(), style: { ...element.style }, points: element.points.slice() };
}

export function findPage(doc: PaperDocument, pageId: string): PaperPage | undefined {
  return doc.pages.find((page) => page.id === pageId);
}
