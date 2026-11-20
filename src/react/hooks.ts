import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
// The React layer only uses the package's public API.
import { createPaperCore, type EngineState, type PaperCore, type PaperCoreOptions } from "../index.js";

/**
 * Creates the engine on an element and destroys it on unmount. Returns a callback ref for the
 * container and the engine (null until mounted).
 *
 * Options are read only on creation (like an input's `defaultValue`): to change the document
 * later, use `engine.loadDocument`. In StrictMode React mounts, unmounts and mounts again: the
 * first engine is destroyed (destroy is idempotent) and a new one is created, with no leaks.
 */
export function useDrawingEngine(options?: PaperCoreOptions): {
  ref: (element: HTMLElement | null) => void;
  engine: PaperCore | null;
} {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [engine, setEngine] = useState<PaperCore | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!element) return;
    const created = createPaperCore(element, optionsRef.current);
    setEngine(created);
    return () => {
      created.destroy();
      setEngine((current) => (current === created ? null : current));
    };
  }, [element]);

  const ref = useCallback((node: HTMLElement | null) => setElement(node), []);
  return { ref, engine };
}

/**
 * The engine's UI state (tool, zoom, active page, undo/redo…), re-rendering only when it
 * changes. `getState()` returns the same object while nothing changes, as
 * `useSyncExternalStore` requires.
 */
export function useEngineState(engine: PaperCore | null): EngineState | null {
  const subscribe = useCallback(
    (notify: () => void) => (engine ? engine.on("state", notify) : () => undefined),
    [engine],
  );
  const getSnapshot = useCallback(() => (engine ? engine.getState() : null), [engine]);
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
