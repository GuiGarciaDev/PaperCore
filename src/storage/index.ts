// API pública de `papercore/storage` (ADR-0008). Depende só do core: quem não persiste não paga.

export type { DocumentMeta, StorageAdapter } from "./types.js";
export { assembleDocument, documentMeta } from "./documentParts.js";
export { MemoryStorageAdapter } from "./memoryAdapter.js";
export { IndexedDbStorageAdapter, type IndexedDbAdapterOptions } from "./indexedDbAdapter.js";
export {
  createAutosave,
  type Autosave,
  type AutosaveOptions,
  type AutosaveSource,
  type AutosaveState,
  type AutosaveStatus,
} from "./autosave.js";
