// PaperCore's public API. Anything not exported here is internal and may change without notice.

export { createPaperCore } from "./engine.js";
export type { EngineState, PaperCore, PaperCoreEvents, PaperCoreOptions } from "./engine.js";

export {
  CURRENT_SCHEMA_VERSION,
  type BackgroundType,
  type BlankBackground,
  type ElementType,
  type GridBackground,
  type HexColor,
  type PageBackground,
  type PaperDocument,
  type PaperElement,
  type PaperPage,
  type RuledBackground,
  type Size,
  type StrokeElement,
  type StrokeStyle,
} from "./core/types.js";
export {
  DEFAULT_BACKGROUNDS,
  DEFAULT_LIMITS,
  DEFAULT_PAGE_SIZE,
  DEFAULT_PEN_STYLE,
  POINT_STRIDE,
  type PaperLimits,
  type PartialLimits,
  type Range,
} from "./core/config.js";
export { createBackground, createDocument, createPage, type BackgroundOverrides } from "./core/document.js";
export { PaperCoreError, type PaperCoreErrorCode } from "./core/errors.js";
export { parseDocument, serializeDocument } from "./core/serialization.js";
export { validateDocument, type ValidationResult } from "./core/validation.js";
export { migrateDocument, type Migration } from "./core/migrations.js";
export type { ChangeReason, DocumentChange } from "./core/store.js";
export type { InputSample, PointerKind } from "./interaction/input.js";
export type { InputPolicyOptions } from "./interaction/pointerPolicy.js";
export type { ToolName } from "./interaction/tools/types.js";
export type { ViewportConfig } from "./rendering/viewport.js";
