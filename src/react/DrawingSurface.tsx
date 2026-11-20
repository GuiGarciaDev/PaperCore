import { useEffect, type CSSProperties } from "react";
import type { PaperCore, PaperCoreOptions } from "../index.js";
import { useDrawingEngine } from "./hooks.js";

export interface DrawingSurfaceProps {
  /** Read on mount only (see `useDrawingEngine`). */
  options?: PaperCoreOptions;
  /** Receives the engine on mount and `null` on unmount. */
  onEngine?: (engine: PaperCore | null) => void;
  className?: string;
  style?: CSSProperties;
  /** Accessible label of the writing area. */
  "aria-label"?: string;
}

/**
 * PaperCore's writing area as a React component. The container needs a defined size
 * (by default it fills 100% of its parent). Toolbar, pages and zoom belong to the app, which uses
 * its own design system and drives the engine received in `onEngine`.
 */
export function DrawingSurface({
  options,
  onEngine,
  className,
  style,
  "aria-label": ariaLabel = "Notebook",
}: DrawingSurfaceProps) {
  const { ref, engine } = useDrawingEngine(options);

  useEffect(() => {
    if (!engine) return;
    onEngine?.(engine);
    return () => onEngine?.(null);
  }, [engine]); // onEngine left out on purpose: swapping the callback must not notify again.

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
