import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
// A camada React só usa a API pública do pacote (ADR-0002).
import { createPaperCore, type EngineState, type PaperCore, type PaperCoreOptions } from "../index.js";

/**
 * Cria a engine num elemento e a destrói ao desmontar. Devolve um callback ref para o container e
 * a engine (null até montar).
 *
 * As opções são lidas só na criação (como o `defaultValue` de um input): para trocar o documento
 * depois, use `engine.loadDocument`. Em StrictMode o React monta, desmonta e monta de novo: a
 * primeira engine é destruída (destroy é idempotente) e uma nova é criada, sem vazamentos.
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
 * Estado de interface da engine (ferramenta, zoom, página ativa, undo/redo…), re-renderizando só
 * quando ele muda. `getState()` devolve o mesmo objeto enquanto nada muda, como o
 * `useSyncExternalStore` exige.
 */
export function useEngineState(engine: PaperCore | null): EngineState | null {
  const subscribe = useCallback(
    (notify: () => void) => (engine ? engine.on("state", notify) : () => undefined),
    [engine],
  );
  const getSnapshot = useCallback(() => (engine ? engine.getState() : null), [engine]);
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
