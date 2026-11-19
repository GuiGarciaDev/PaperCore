import { useEffect, type CSSProperties } from "react";
import type { PaperCore, PaperCoreOptions } from "../index.js";
import { useDrawingEngine } from "./hooks.js";

export interface DrawingSurfaceProps {
  /** Lidas só na montagem (ver `useDrawingEngine`). */
  options?: PaperCoreOptions;
  /** Recebe a engine ao montar e `null` ao desmontar. */
  onEngine?: (engine: PaperCore | null) => void;
  className?: string;
  style?: CSSProperties;
  /** Rótulo acessível da área de escrita. */
  "aria-label"?: string;
}

/**
 * Área de escrita do PaperCore como componente React. O container precisa de tamanho definido
 * (por padrão ocupa 100% do pai). Toolbar, páginas e zoom ficam com a aplicação, que usa o próprio
 * design system e controla a engine recebida em `onEngine`.
 */
export function DrawingSurface({
  options,
  onEngine,
  className,
  style,
  "aria-label": ariaLabel = "Caderno",
}: DrawingSurfaceProps) {
  const { ref, engine } = useDrawingEngine(options);

  useEffect(() => {
    if (!engine) return;
    onEngine?.(engine);
    return () => onEngine?.(null);
  }, [engine]); // onEngine fora de propósito: trocar o callback não deve notificar de novo.

  return (
    <div
      ref={ref}
      className={className}
      aria-label={ariaLabel}
      role="application"
      style={{ position: "relative", width: "100%", height: "100%", ...style }}
    />
  );
}
