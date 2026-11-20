// Public API of `papercore/storage`. Depends only on the core: no persistence, no cost.

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
