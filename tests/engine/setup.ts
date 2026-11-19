import { vi } from "vitest";
import { createPaperCore, type PaperCore, type PaperCoreOptions } from "../../src/engine.js";

/**
 * Ambiente mínimo para a engine no happy-dom: o happy-dom não implementa Canvas 2D, então o
 * contexto vira um objeto que aceita qualquer chamada, e o Path2D, uma classe vazia. Os testes
 * da engine verificam estado e eventos, não pixels (os pixels são verificados no navegador).
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

/** Cria a engine num container com tamanho (o happy-dom não faz layout). */
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
