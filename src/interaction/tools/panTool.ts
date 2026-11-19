import type { InputSample } from "../input.js";
import type { Tool, ToolContext } from "./types.js";

export class PanTool implements Tool {
  readonly name = "pan" as const;
  private last: { x: number; y: number } | null = null;

  constructor(private readonly ctx: ToolContext) {}

  begin(sample: InputSample): void {
    this.last = { x: sample.screenX, y: sample.screenY };
  }

  move(samples: readonly InputSample[]): void {
    const sample = samples[samples.length - 1];
    if (!this.last || !sample) return;
    this.ctx.panBy(sample.screenX - this.last.x, sample.screenY - this.last.y);
    this.last = { x: sample.screenX, y: sample.screenY };
  }

  end(): void {
    this.last = null;
  }

  cancel(): void {
    this.last = null;
  }
}
