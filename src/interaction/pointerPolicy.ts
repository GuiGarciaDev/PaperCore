import type { PointerKind } from "./input.js";

export interface InputPolicyOptions {
  /** Tipos de ponteiro que podem desenhar. Padrão: todos. */
  readonly drawWith?: readonly PointerKind[];
  /**
   * Rejeição de palma: depois que uma caneta é detectada, o toque deixa de desenhar e passa a fazer
   * pan/pinça. Padrão: `true`.
   */
  readonly palmRejection?: boolean;
}

/** Decide quem pode desenhar. Puro e testável. */
export class PointerPolicy {
  private readonly drawWith: ReadonlySet<PointerKind>;
  private readonly palmRejection: boolean;
  private penDetected = false;

  constructor(options: InputPolicyOptions = {}) {
    this.drawWith = new Set(options.drawWith ?? ["mouse", "pen", "touch"]);
    this.palmRejection = options.palmRejection ?? true;
  }

  /** Registra o tipo de um ponteiro que tocou a superfície. */
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
