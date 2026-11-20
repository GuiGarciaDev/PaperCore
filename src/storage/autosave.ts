import { Emitter } from "../core/emitter.js";
import { PaperCoreError } from "../core/errors.js";
import type { DocumentChange } from "../core/store.js";
import type { PaperDocument } from "../core/types.js";
import { documentMeta } from "./documentParts.js";
import type { StorageAdapter } from "./types.js";

/**
 * - `idle`: nothing changed since the start (or since the last `load`).
 * - `dirty`: there are changes waiting for the debounce.
 * - `saving`: writing to the adapter.
 * - `saved`: everything written to the adapter (does NOT mean synced with a server).
 * - `error`: the last write failed; a retry is scheduled.
 */
export type AutosaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export interface AutosaveState {
  readonly status: AutosaveStatus;
  /** Error from the last attempt, if `status === "error"`. */
  readonly error: unknown;
  /** Time (`Date.now()`) of the last successful save. */
  readonly lastSavedAt: number | null;
}

/** What the autosave needs from the engine (the engine and `PaperStore` both fit). */
export interface AutosaveSource {
  getDocument(): PaperDocument;
  on(type: "change", listener: (change: DocumentChange) => void): () => void;
}

export interface AutosaveOptions {
  /** Wait after the last change (ms). Default: 800. */
  delay?: number;
  /** With continuous changes, save after this time at the latest (ms). Default: 5000. */
  maxWait?: number;
  /** First wait after a failure; doubles on each failure, up to 30 s. Default: 1000. */
  retryDelay?: number;
  /**
   * Window used to flush on `visibilitychange`/`pagehide`. Default: `globalThis` when there is a
   * `document`. Pass `null` to turn it off.
   */
  window?: Window | null;
}

export interface Autosave {
  getState(): AutosaveState;
  on(type: "state", listener: (state: AutosaveState) => void): () => void;
  /**
   * Writes everything that changed up to this moment right now. Rejects if the write fails.
   * Use it before actions that depend on the saved document.
   */
  flush(): Promise<void>;
  /** Marks the whole document dirty and writes it (for the first save or after an import). */
  saveAll(): Promise<void>;
  /** Stops observing. Changes not yet written are discarded: call `flush()` first. */
  destroy(): void;
}

/** A batch of changes to one document. `generation` is the one of the last change included. */
interface Batch {
  doc: PaperDocument;
  dirty: Set<string>;
  deleted: Set<string>;
  generation: number;
}

const MAX_RETRY_DELAY = 30_000;

/**
 * Per-page autosave. Every change bumps the "generation". A save only moves the
 * state to `saved` if no change arrived while it was writing; otherwise the state goes back
 * to `dirty` and another save is scheduled. So `saved` never shows up with pending
 * changes.
 *
 * `reason: "load"` does not mark the document dirty. If the previous document has pending changes,
 * they are written first (the batch keeps the old document's immutable snapshot).
 */
export function createAutosave(
  source: AutosaveSource,
  adapter: StorageAdapter,
  options: AutosaveOptions = {},
): Autosave {
  return new AutosaveController(source, adapter, options);
}

class AutosaveController implements Autosave {
  private readonly emitter = new Emitter<{ state: AutosaveState }>();
  private readonly delay: number;
  private readonly maxWait: number;
  private readonly retryDelay: number;
  private readonly view: Window | null;
  private readonly unsubscribe: () => void;

  private state: AutosaveState = { status: "idle", error: null, lastSavedAt: null };
  private generation = 0;
  private savedGeneration = 0;
  private open: Batch | null = null;
  private readonly queue: Batch[] = [];
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private firstPendingAt: number | null = null;
  private failures = 0;
  private destroyed = false;

  constructor(
    private readonly source: AutosaveSource,
    private readonly adapter: StorageAdapter,
    options: AutosaveOptions,
  ) {
    this.delay = options.delay ?? 800;
    this.maxWait = options.maxWait ?? 5000;
    this.retryDelay = options.retryDelay ?? 1000;
    this.view =
      options.window !== undefined
        ? options.window
        : typeof document !== "undefined"
          ? (globalThis as unknown as Window)
          : null;
    this.unsubscribe = source.on("change", (change) => this.onChange(change));
    this.view?.addEventListener("pagehide", this.onLeave);
    this.view?.document.addEventListener("visibilitychange", this.onVisibility);
  }

  getState(): AutosaveState {
    return this.state;
  }

  on(type: "state", listener: (state: AutosaveState) => void): () => void {
    return this.emitter.on(type, listener);
  }

  async flush(): Promise<void> {
    this.assertAlive();
    this.clearTimer();
    this.seal();
    while (this.queue.length > 0 || this.running) {
      await this.run();
      if (this.state.status === "error") throw this.state.error;
    }
  }

  saveAll(): Promise<void> {
    this.assertAlive();
    const doc = this.source.getDocument();
    const batch = this.openBatch(doc);
    for (const page of doc.pages) batch.dirty.add(page.id);
    this.bump(batch);
    return this.flush();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearTimer();
    this.unsubscribe();
    this.view?.removeEventListener("pagehide", this.onLeave);
    this.view?.document.removeEventListener("visibilitychange", this.onVisibility);
    this.emitter.clear();
  }

  // ── Changes ──────────────────────────────────────────────────────────────

  private onChange(change: DocumentChange): void {
    if (this.destroyed) return;
    if (change.reason === "load") {
      // The previous document may have pending changes: write them now (with the old snapshot).
      if (this.open) {
        this.seal();
        this.clearTimer();
        void this.run();
      } else if (this.queue.length === 0 && !this.running) {
        this.setState({ status: "idle", error: null });
      }
      return;
    }
    const batch = this.openBatch(this.source.getDocument());
    for (const id of [...change.changedPageIds, ...change.addedPageIds]) {
      batch.dirty.add(id);
      batch.deleted.delete(id);
    }
    for (const id of change.deletedPageIds) {
      batch.dirty.delete(id);
      batch.deleted.add(id);
    }
    // Order-only change: the meta (pageIds) is written with every batch.
    this.bump(batch);
  }

  private openBatch(doc: PaperDocument): Batch {
    if (!this.open || this.open.doc.id !== doc.id) {
      this.seal();
      this.open = { doc, dirty: new Set(), deleted: new Set(), generation: this.generation };
    }
    this.open.doc = doc;
    return this.open;
  }

  private bump(batch: Batch): void {
    this.generation += 1;
    batch.generation = this.generation;
    this.firstPendingAt ??= Date.now();
    if (this.state.status !== "saving") this.setState({ status: "dirty" });
    this.schedule();
  }

  private schedule(): void {
    if (this.destroyed) return;
    this.clearTimer();
    const waited = Date.now() - (this.firstPendingAt ?? Date.now());
    const wait = Math.max(0, Math.min(this.delay, this.maxWait - waited));
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.seal();
      void this.run();
    }, wait);
  }

  /** Closes the open batch and puts it in the write queue. */
  private seal(): void {
    if (!this.open) return;
    this.queue.push(this.open);
    this.open = null;
    this.firstPendingAt = null;
  }

  // ── Writing ──────────────────────────────────────────────────────────────

  private run(): Promise<void> {
    this.running ??= this.work().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async work(): Promise<void> {
    while (this.queue.length > 0 && !this.destroyed) {
      const { batch, count } = this.mergeHead();
      this.setState({ status: "saving" });
      try {
        const doc = batch.doc;
        const pages = doc.pages.filter((p) => batch.dirty.has(p.id));
        const savedAt = Date.now();
        // Meta and pages first; deletions afterwards. If the app closes in between, the meta no
        // longer lists the deleted pages, and loading ignores them.
        await this.adapter.savePages(doc.id, pages, documentMeta(doc, savedAt));
        if (batch.deleted.size > 0) await this.adapter.deletePages(doc.id, [...batch.deleted]);
        this.queue.splice(0, count);
        this.savedGeneration = Math.max(this.savedGeneration, batch.generation);
        this.failures = 0;
        this.state = { ...this.state, lastSavedAt: savedAt };
      } catch (error) {
        if (this.destroyed) return;
        // Keep the batches in the queue (already merged) and try again later.
        this.queue.splice(0, count, batch);
        this.failures += 1;
        this.setState({ status: "error", error: toError(error) });
        this.scheduleRetry();
        return;
      }
    }
    if (this.destroyed) return;
    const pending = this.open !== null || this.queue.length > 0 || this.savedGeneration < this.generation;
    this.setState({ status: pending ? "dirty" : "saved", error: null });
  }

  /** Merges the batches at the head of the queue that belong to the same document. */
  private mergeHead(): { batch: Batch; count: number } {
    const head = this.queue[0]!;
    const merged: Batch = {
      doc: head.doc,
      dirty: new Set(head.dirty),
      deleted: new Set(head.deleted),
      generation: head.generation,
    };
    let count = 1;
    while (count < this.queue.length && this.queue[count]!.doc.id === head.doc.id) {
      const next = this.queue[count]!;
      for (const id of next.dirty) {
        merged.dirty.add(id);
        merged.deleted.delete(id);
      }
      for (const id of next.deleted) {
        merged.dirty.delete(id);
        merged.deleted.add(id);
      }
      merged.doc = next.doc;
      merged.generation = next.generation;
      count += 1;
    }
    return { batch: merged, count };
  }

  private scheduleRetry(): void {
    this.clearTimer();
    const wait = Math.min(MAX_RETRY_DELAY, this.retryDelay * 2 ** (this.failures - 1));
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.seal();
      void this.run();
    }, wait);
  }

  // ── Leaving the page ─────────────────────────────────────────────────────

  private readonly onLeave = (): void => {
    if (this.destroyed) return;
    this.clearTimer();
    this.seal();
    void this.run();
  };

  private readonly onVisibility = (): void => {
    if (this.view?.document.visibilityState === "hidden") this.onLeave();
  };

  // ── Utilities ─────────────────────────────────────────────────────────────

  private setState(patch: Partial<AutosaveState>): void {
    const next = { ...this.state, ...patch };
    if (next.status === this.state.status && next.error === this.state.error) {
      this.state = next;
      return;
    }
    this.state = next;
    this.emitter.emit("state", next);
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private assertAlive(): void {
    if (this.destroyed) throw new PaperCoreError("INVALID_ARGUMENT", "The autosave was already destroyed.");
  }
}

function toError(error: unknown): unknown {
  return error instanceof Error ? error : new PaperCoreError("STORAGE_ERROR", String(error));
}
