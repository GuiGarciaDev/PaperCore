/** STRUCTURAL version of the document format. Not to be confused with a persistence revision. */
export const CURRENT_SCHEMA_VERSION = 1;

/** Color in `#rrggbb` format (validated). */
export type HexColor = string;

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface BlankBackground {
  readonly type: "blank";
  readonly color: HexColor;
}

export interface RuledBackground {
  readonly type: "ruled";
  readonly color: HexColor;
  readonly lineColor: HexColor;
  /** Distance between lines, in logical units. */
  readonly spacing: number;
  /** Line thickness, in logical units. */
  readonly lineWidth: number;
}

export interface GridBackground {
  readonly type: "grid";
  readonly color: HexColor;
  readonly lineColor: HexColor;
  readonly spacing: number;
  readonly lineWidth: number;
}

export type PageBackground = BlankBackground | RuledBackground | GridBackground;
export type BackgroundType = PageBackground["type"];

export interface StrokeStyle {
  readonly color: HexColor;
  /** Nominal width in logical units (scales with zoom). */
  readonly width: number;
}

export interface StrokeElement {
  readonly id: string;
  readonly type: "stroke";
  readonly style: StrokeStyle;
  /** `false` for mouse/touch: the stored pressure (0.5) is ignored by the renderer. */
  readonly hasPressure: boolean;
  /** Flat array with stride `POINT_STRIDE`: `[x, y, pressure, x, y, pressure, …]`. */
  readonly points: readonly number[];
}

/** Discriminated union on `type`. New elements (text, shapes, images) go here. */
export type PaperElement = StrokeElement;
export type ElementType = PaperElement["type"];

export interface PaperPage {
  readonly id: string;
  /** Logical page size. */
  readonly size: Size;
  readonly background: PageBackground;
  /** Array order is drawing order (z-order). */
  readonly elements: readonly PaperElement[];
}

export interface PaperDocument {
  readonly id: string;
  readonly schemaVersion: number;
  /** Size used to create new pages. */
  readonly defaultPageSize: Size;
  /** Array order is page order. There is always at least one. */
  readonly pages: readonly PaperPage[];
}
