import type { PointerKind } from "./input.js";

export interface InputPolicyOptions {
  /** Pointer kinds allowed to draw. Default: all. */
  readonly drawWith?: readonly PointerKind[];
  /**
   * Palm rejection: once a pen is detected, touch stops drawing and pans/pinches
   * instead. Default: `true`.
   */
  readonly palmRejection?: boolean;
}

/** Decides who may draw. Pure and testable. */
export class PointerPolicy {
  private readonly drawWith: ReadonlySet<PointerKind>;
  private readonly palmRejection: boolean;
  private penDetected = false;

  constructor(options: InputPolicyOptions = {}) {
    this.drawWith = new Set(options.drawWith ?? ["mouse", "pen", "touch"]);
    this.palmRejection = options.palmRejection ?? true;
  }

  /** Records the kind of a pointer that touched the surface. */
  observe(kind: PointerKind): void {
    if (kind === "pen") this.penDetected = true;
  }

  isPenDetected(): boolean {
    return this.penDetected;
  }

  canDraw(kind: PointerKind): boolean {
    if (!this.drawWith.has(kind)) return false;
    if (kind === "touch" && this.palmRejection && this.penDetected) return false;
    return true;
  }
}
