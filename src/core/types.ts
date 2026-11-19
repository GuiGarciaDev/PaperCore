/** Versão ESTRUTURAL do formato do documento. Não confundir com revisão de persistência. */
export const CURRENT_SCHEMA_VERSION = 1;

/** Cor no formato `#rrggbb` (validada). */
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
  /** Distância entre linhas, em unidades lógicas. */
  readonly spacing: number;
  /** Espessura das linhas, em unidades lógicas. */
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
  /** Espessura nominal em unidades lógicas (escala com o zoom). */
  readonly width: number;
}

export interface StrokeElement {
  readonly id: string;
  readonly type: "stroke";
  readonly style: StrokeStyle;
  /** `false` para mouse/touch: a pressão gravada (0.5) é ignorada na renderização. */
  readonly hasPressure: boolean;
  /** Array plano com passo `POINT_STRIDE`: `[x, y, pressure, x, y, pressure, …]`. */
  readonly points: readonly number[];
}

/** União discriminada por `type`. Novos elementos (texto, formas, imagens) entram aqui. */
export type PaperElement = StrokeElement;
export type ElementType = PaperElement["type"];

export interface PaperPage {
  readonly id: string;
  /** Tamanho lógico da página. */
  readonly size: Size;
  readonly background: PageBackground;
  /** A ordem do array é a ordem de desenho (z-order). */
  readonly elements: readonly PaperElement[];
}

export interface PaperDocument {
  readonly id: string;
  readonly schemaVersion: number;
  /** Tamanho usado para criar páginas novas. */
  readonly defaultPageSize: Size;
  /** A ordem do array é a ordem das páginas. Sempre há pelo menos uma. */
  readonly pages: readonly PaperPage[];
}
