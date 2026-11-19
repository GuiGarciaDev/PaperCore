import type { PaperLimits } from "../../core/config.js";
import type { PaperStore } from "../../core/store.js";
import type { StrokeStyle } from "../../core/types.js";
import type { LiveStroke } from "../../rendering/renderer.js";
import type { ViewTransform } from "../../rendering/viewport.js";
import type { InputSample } from "../input.js";

export type ToolName = "pen" | "pan";

export interface ToolSettings {
  readonly pen: StrokeStyle;
}

/** O que uma ferramenta pode usar. As ferramentas nunca calculam transformações por conta própria. */
export interface ToolContext {
  readonly store: PaperStore;
  readonly limits: PaperLimits;
  getActivePageId(): string;
  getTransform(): ViewTransform;
  getSettings(): ToolSettings;
  setLiveStroke(live: LiveStroke | null): void;
  /** Move o viewport em pixels de tela. */
  panBy(dx: number, dy: number): void;
}

/**
 * Ciclo de vida de um gesto:
 * `begin` → `move`* → `end` (confirma) ou `cancel` (descarta).
 */
export interface Tool {
  readonly name: ToolName;
  begin(sample: InputSample): void;
  /** Recebe todas as amostras desde o último evento (inclui eventos coalescidos). */
  move(samples: readonly InputSample[]): void;
  end(): void;
  cancel(): void;
}
