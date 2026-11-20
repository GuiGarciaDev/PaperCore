// @vitest-environment happy-dom
import { act, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineState, PaperCore } from "../../src/index.js";
import { DrawingSurface } from "../../src/react/DrawingSurface.js";
import { useEngineState } from "../../src/react/hooks.js";
import { installCanvasStubs } from "../engine/setup.js";

// Tells React this environment uses act().
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  installCanvasStubs();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("<DrawingSurface>", () => {
  it("in StrictMode it ends with ONE live engine and a single set of canvases", () => {
    const engines: (PaperCore | null)[] = [];
    act(() =>
      root.render(
        <StrictMode>
          <DrawingSurface onEngine={(e) => engines.push(e)} />
        </StrictMode>,
      ),
    );
    const live = engines.filter((e): e is PaperCore => e !== null);
    const last = live.at(-1)!;
    expect(engines.at(-1)).toBe(last);
    expect(container.querySelectorAll("[data-papercore]")).toHaveLength(1);
    expect(container.querySelectorAll("canvas")).toHaveLength(3);
    // Engines discarded by StrictMode were destroyed: using them throws.
    for (const old of live.slice(0, -1)) expect(() => old.addPage()).toThrow();
    expect(() => last.addPage()).not.toThrow();
  });

  it("on unmount it destroys the engine, removes the DOM and reports null", () => {
    let current: PaperCore | null = null;
    act(() => root.render(<DrawingSurface onEngine={(e) => (current = e)} />));
    const engine = current!;
    act(() => root.render(<div />));
    expect(current).toBeNull();
    expect(container.querySelector("[data-papercore]")).toBeNull();
    expect(() => engine.addPage()).toThrow();
  });

  it("passes the initial options through", () => {
    let current: PaperCore | null = null;
    act(() =>
      root.render(
        <DrawingSurface options={{ readOnly: true, tool: "pan" }} onEngine={(e) => (current = e)} />,
      ),
    );
    expect(current!.getState().readOnly).toBe(true);
    expect(current!.getState().tool).toBe("pan");
  });
});

describe("useEngineState", () => {
  it("re-renders when the engine state changes", () => {
    const seen: (EngineState | null)[] = [];
    let engineRef: PaperCore | null = null;
    function App() {
      const [engine, setEngine] = useState<PaperCore | null>(null);
      const state = useEngineState(engine);
      seen.push(state);
      return (
        <>
          <DrawingSurface
            onEngine={(e) => {
              engineRef = e;
              setEngine(e);
            }}
          />
          <output>{state ? `${state.activePageIndex + 1}/${state.pageCount}` : "—"}</output>
        </>
      );
    }
    act(() => root.render(<App />));
    expect(container.querySelector("output")!.textContent).toBe("1/1");
    act(() => {
      engineRef!.addPage();
    });
    expect(container.querySelector("output")!.textContent).toBe("2/2");
    act(() => engineRef!.setTool("eraser"));
    expect(seen.at(-1)!.tool).toBe("eraser");
  });

  it("returns null without an engine", () => {
    let value: EngineState | null | undefined;
    function Probe() {
      value = useEngineState(null);
      return null;
    }
    act(() => root.render(<Probe />));
    expect(value).toBeNull();
  });
});
