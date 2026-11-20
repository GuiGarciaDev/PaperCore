import { toInputSample, toPointerKind, type InputSample, type PointerKind } from "./input.js";
import type { PointerPolicy } from "./pointerPolicy.js";
import type { Tool } from "./tools/types.js";

export interface PinchUpdate {
  /** Previous and current midpoint, in the container's CSS pixels. */
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  /** Ratio between the current and previous finger distance. */
  readonly ratio: number;
}

export interface WheelUpdate {
  readonly x: number;
  readonly y: number;
  readonly dx: number;
  readonly dy: number;
  /** `true` with Ctrl/⌘ (or a trackpad pinch, which browsers report as Ctrl+wheel). */
  readonly zoom: boolean;
}

export interface PointerControllerHost {
  readonly policy: PointerPolicy;
  /** Picks the tool for this pointer (or `null` to ignore it). */
  resolveTool(kind: PointerKind, button: number): Tool | null;
  toLogical(sx: number, sy: number): { x: number; y: number };
  pinch(update: PinchUpdate): void;
  wheel(update: WheelUpdate): void;
  onSample?(sample: InputSample): void;
  onError(error: unknown): void;
}

interface ActivePointer {
  readonly id: number;
  readonly kind: PointerKind;
  readonly tool: Tool;
}

interface Point {
  x: number;
  y: number;
}

const LINE_HEIGHT_PX = 16;

/**
 * Turns Pointer Events into gestures:
 * - only one pointer draws at a time;
 * - two fingers pinch (zoom + pan); a 2nd finger cancels a finger stroke;
 * - the finger left after a pinch is ignored until it is lifted;
 * - while the pen writes, touches (palm) are ignored;
 * - `pointercancel` discards; `lostpointercapture`/`blur` commit, keeping the ink.
 */
export class PointerController {
  private active: ActivePointer | null = null;
  private readonly touches = new Map<number, Point>();
  private readonly suppressed = new Set<number>();
  private pinchState: { mid: Point; distance: number } | null = null;
  private origin = { left: 0, top: 0 };
  private destroyed = false;

  constructor(
    private readonly target: HTMLElement,
    private readonly host: PointerControllerHost,
  ) {
    target.addEventListener("pointerdown", this.onDown);
    target.addEventListener("pointermove", this.onMove);
    target.addEventListener("pointerup", this.onUp);
    target.addEventListener("pointercancel", this.onCancel);
    target.addEventListener("lostpointercapture", this.onLostCapture);
    target.addEventListener("wheel", this.onWheel, { passive: false });
    target.addEventListener("contextmenu", this.onContextMenu);
    target.ownerDocument.defaultView?.addEventListener("blur", this.onBlur);
  }

  isBusy(): boolean {
    return this.active !== null || this.pinchState !== null;
  }

  /** Discards the current gesture (for example, when entering read-only mode). */
  cancelActive(): void {
    const active = this.active;
    this.active = null;
    if (active) this.safely(() => active.tool.cancel());
  }

  /** Ends the current gesture, keeping what was drawn. */
  endActive(): void {
    const active = this.active;
    this.active = null;
    if (active) this.safely(() => active.tool.end());
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelActive();
    const t = this.target;
    t.removeEventListener("pointerdown", this.onDown);
    t.removeEventListener("pointermove", this.onMove);
    t.removeEventListener("pointerup", this.onUp);
    t.removeEventListener("pointercancel", this.onCancel);
    t.removeEventListener("lostpointercapture", this.onLostCapture);
    t.removeEventListener("wheel", this.onWheel);
    t.removeEventListener("contextmenu", this.onContextMenu);
    t.ownerDocument.defaultView?.removeEventListener("blur", this.onBlur);
  }

  private readonly onDown = (e: PointerEvent): void => {
    const kind = toPointerKind(e.pointerType);
    this.host.policy.observe(kind);
    this.updateOrigin();
    if (e.pointerType !== "touch") e.preventDefault();

    if (kind === "touch") {
      this.touches.set(e.pointerId, this.screenPoint(e));
      // Palm resting while the pen writes: ignore it.
      if (this.active && this.active.kind !== "touch") {
        this.suppressed.add(e.pointerId);
        return;
      }
      if (this.touches.size === 2) {
        this.startPinch();
        return;
      }
      if (this.touches.size > 2 || this.pinchState) return;
    } else {
      if (this.active) return; // um ponteiro desenha por vez
      if (this.pinchState) {
        // The pen wins: end the pinch and ignore the current fingers.
        this.pinchState = null;
        for (const id of this.touches.keys()) this.suppressed.add(id);
      }
    }

    if (this.active) return;
    const tool = this.host.resolveTool(kind, e.button);
    if (!tool) return;
    try {
      this.target.setPointerCapture(e.pointerId);
    } catch {
      // Pointer already released by the browser: continue without capture.
    }
    this.active = { id: e.pointerId, kind, tool };
    const sample = this.sample(e);
    this.safely(() => tool.begin(sample));
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, this.screenPoint(e));
      if (this.pinchState) {
        this.updatePinch();
        return;
      }
    }
    const active = this.active;
    if (!active || active.id !== e.pointerId) return;
    const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    const samples = (events.length > 0 ? events : [e]).map((ev) => this.sample(ev));
    this.safely(() => active.tool.move(samples));
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (this.active?.id === e.pointerId) this.endActive();
    this.releaseTouch(e.pointerId);
  };

  private readonly onCancel = (e: PointerEvent): void => {
    if (this.active?.id === e.pointerId) this.cancelActive();
    this.releaseTouch(e.pointerId);
  };

  /** Capture lost without `pointerup` (for example, an alert): commit, keeping the ink. */
  private readonly onLostCapture = (e: PointerEvent): void => {
    if (this.active?.id === e.pointerId) this.endActive();
  };

  private readonly onBlur = (): void => {
    this.endActive();
    this.pinchState = null;
    this.touches.clear();
    this.suppressed.clear();
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.updateOrigin();
    const unit = e.deltaMode === 1 ? LINE_HEIGHT_PX : e.deltaMode === 2 ? this.target.clientHeight : 1;
    this.safely(() =>
      this.host.wheel({
        x: e.clientX - this.origin.left,
        y: e.clientY - this.origin.top,
        dx: e.deltaX * unit,
        dy: e.deltaY * unit,
        zoom: e.ctrlKey || e.metaKey,
      }),
    );
  };

  private readonly onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private releaseTouch(pointerId: number): void {
    if (!this.touches.delete(pointerId)) return;
    this.suppressed.delete(pointerId);
    if (this.pinchState && this.touches.size < 2) {
      this.pinchState = null;
      // The remaining finger must not start drawing.
      for (const id of this.touches.keys()) this.suppressed.add(id);
    }
  }

  private startPinch(): void {
    if (this.active?.kind === "touch") this.cancelActive(); // a 2nd finger cancels the 1st finger's stroke
    const [a, b] = this.pinchPoints();
    if (!a || !b) return;
    this.pinchState = { mid: midpoint(a, b), distance: Math.max(1, distance(a, b)) };
  }

  private updatePinch(): void {
    const state = this.pinchState;
    const [a, b] = this.pinchPoints();
    if (!state || !a || !b) return;
    const mid = midpoint(a, b);
    const dist = Math.max(1, distance(a, b));
    this.safely(() =>
      this.host.pinch({
        fromX: state.mid.x,
        fromY: state.mid.y,
        toX: mid.x,
        toY: mid.y,
        ratio: dist / state.distance,
      }),
    );
    this.pinchState = { mid, distance: dist };
  }

  private pinchPoints(): (Point | undefined)[] {
    return [...this.touches.values()].slice(0, 2);
  }

  private updateOrigin(): void {
    const rect = this.target.getBoundingClientRect();
    this.origin = { left: rect.left, top: rect.top };
  }

  private screenPoint(e: PointerEvent): Point {
    return { x: e.clientX - this.origin.left, y: e.clientY - this.origin.top };
  }

  private sample(e: PointerEvent): InputSample {
    const sample = toInputSample(e, this.origin, (sx, sy) => this.host.toLogical(sx, sy));
    this.host.onSample?.(sample);
    return sample;
  }

  private safely(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      this.host.onError(error);
    }
  }
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
