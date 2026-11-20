import { vi } from "vitest";
import { createPaperCore, type PaperCore, type PaperCoreOptions } from "../../src/engine.js";

/**
 * Minimal environment for the engine in happy-dom: happy-dom does not implement Canvas 2D, so the
 * context becomes an object that accepts any call, and Path2D an empty class. Engine tests check
 * state and events, not pixels (pixels are checked in the browser).
 */
export function installCanvasStubs(): void {
  const noop = () => undefined;
  const fakeContext = () =>
    new Proxy({} as Record<string | symbol, unknown>, {
      get: (target, key) => (key in target ? target[key] : noop),
      set: (target, key, value) => {
        target[key] = value;
        return true;
      },
    });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => fakeContext() as unknown as CanvasRenderingContext2D,
  );
  vi.stubGlobal(
    "Path2D",
    class {
      moveTo() {}
      lineTo() {}
      arc() {}
      closePath() {}
      rect() {}
      addPath() {}
    },
  );
}

/** Creates the engine in a sized container (happy-dom does no layout). */
export function mountEngine(options: PaperCoreOptions = {}): { engine: PaperCore; container: HTMLElement } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 800,
    height: 600,
    right: 800,
    bottom: 600,
    toJSON: () => ({}),
  } as DOMRect);
  return { engine: createPaperCore(container, options), container };
}
