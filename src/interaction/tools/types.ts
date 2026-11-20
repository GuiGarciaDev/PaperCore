import type { PaperLimits } from "../../core/config.js";
import type { PaperStore } from "../../core/store.js";
import type { PaperPage, StrokeStyle } from "../../core/types.js";
import type { EraserCursor, LiveStroke } from "../../rendering/renderer.js";
import type { ViewTransform } from "../../rendering/viewport.js";
import type { InputSample } from "../input.js";

export type ToolName = "pen" | "eraser" | "pan";

export interface ToolSettings {
  readonly pen: StrokeStyle;
  /** Eraser diameter in SCREEN pixels (same feel at any zoom). */
  readonly eraserSize: number;
}

/** What a tool may use. Tools never compute transforms on their own. */
export interface ToolContext {
  readonly store: PaperStore;
  readonly limits: PaperLimits;
  getActivePageId(): string;
  getTransform(): ViewTransform;
  getSettings(): ToolSettings;
  setLiveStroke(live: LiveStroke | null): void;
  /** Shows a provisional version of the page (the eraser effect before committing). `null` goes back to the store. */
  setPreviewPage(page: PaperPage | null): void;
  setEraserCursor(cursor: EraserCursor | null): void;
  /** Moves the viewport in screen pixels. */
  panBy(dx: number, dy: number): void;
}

/**
 * Gesture lifecycle:
 * `begin` → `move`* → `end` (commit) or `cancel` (discard).
 */
export interface Tool {
  readonly name: ToolName;
  begin(sample: InputSample): void;
  /** Receives every sample since the last event (including coalesced events). */
  move(samples: readonly InputSample[]): void;
  end(): void;
  cancel(): void;
}
