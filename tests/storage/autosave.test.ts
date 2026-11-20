import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDocument } from "../../src/core/document.js";
import { addElementsOperation } from "../../src/core/operations.js";
import { PaperStore } from "../../src/core/store.js";
import type { PaperPage } from "../../src/core/types.js";
import { createAutosave, type AutosaveStatus } from "../../src/storage/autosave.js";
import { MemoryStorageAdapter } from "../../src/storage/memoryAdapter.js";
import type { DocumentMeta } from "../../src/storage/types.js";
import { stroke } from "../helpers.js";

/** In-memory adapter that records calls and can fail or hold writes. */
class SpyAdapter extends MemoryStorageAdapter {
  saves: { pageIds: string[]; meta: DocumentMeta }[] = [];
  deletes: string[][] = [];
  failNext = 0;
  gate: Promise<void> | null = null;

  override async savePages(documentId: string, pages: readonly PaperPage[], meta: DocumentMeta) {
    if (this.gate) await this.gate;
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error("disk full");
    }
    this.saves.push({ pageIds: pages.map((p) => p.id), meta });
    await super.savePages(documentId, pages, meta);
  }

  override async deletePages(documentId: string, pageIds: readonly string[]) {
    this.deletes.push([...pageIds]);
    await super.deletePages(documentId, pageIds);
  }
}

function setup(options: Parameters<typeof createAutosave>[2] = {}) {
  const store = new PaperStore(createDocument());
  const adapter = new SpyAdapter();
  const autosave = createAutosave(store, adapter, { delay: 100, maxWait: 1000, window: null, ...options });
  const statuses: AutosaveStatus[] = [];
  autosave.on("state", (s) => statuses.push(s.status));
  const pageId = () => store.getDocument().pages[0]!.id;
  const draw = (id = pageId()) => store.apply(addElementsOperation(store.getPage(id), [stroke()]));
  return { store, adapter, autosave, statuses, draw, pageId };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("autosave", () => {
  it("starts idle and saves nothing without changes", async () => {
    const { autosave, adapter } = setup();
    expect(autosave.getState().status).toBe("idle");
    await vi.advanceTimersByTimeAsync(5000);
    expect(adapter.saves).toHaveLength(0);
  });

  it("debounce: several changes become a single save with the dirty pages", async () => {
    const { autosave, adapter, draw, statuses, store } = setup();
    store.addPage(); // another page, not touched afterwards
    await autosave.flush();
    adapter.saves = [];
    draw();
    draw();
    draw();
    expect(autosave.getState().status).toBe("dirty");
    await vi.advanceTimersByTimeAsync(99);
    expect(adapter.saves).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(adapter.saves).toHaveLength(1);
    expect(adapter.saves[0]!.pageIds).toEqual([store.getDocument().pages[0]!.id]);
    expect(autosave.getState().status).toBe("saved");
    expect(statuses.slice(-3)).toEqual(["dirty", "saving", "saved"]);
  });

  it("maxWait: continuous changes do not postpone saving forever", async () => {
    const { adapter, draw } = setup();
    for (let t = 0; t < 1100; t += 50) {
      draw();
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(adapter.saves.length).toBeGreaterThanOrEqual(1);
  });

  it("race: a change during saving goes back to dirty, never saved with pending changes", async () => {
    const { autosave, adapter, draw, statuses } = setup();
    let release!: () => void;
    adapter.gate = new Promise((r) => (release = r));
    draw();
    await vi.advanceTimersByTimeAsync(100);
    expect(autosave.getState().status).toBe("saving");
    draw(); // arrives while writing
    adapter.gate = null;
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(autosave.getState().status).toBe("dirty");
    expect(statuses).not.toContain("saved");
    await vi.advanceTimersByTimeAsync(100);
    expect(autosave.getState().status).toBe("saved");
    expect(adapter.saves).toHaveLength(2);
  });

  it("flush writes immediately and the result loads equal to the document", async () => {
    const { autosave, adapter, draw, store } = setup();
    draw();
    await autosave.flush();
    expect(autosave.getState().status).toBe("saved");
    expect(await adapter.load(store.getDocument().id)).toEqual(store.getDocument());
  });

  it("flush waits for a save in progress", async () => {
    const { autosave, adapter, draw } = setup();
    let release!: () => void;
    adapter.gate = new Promise((r) => (release = r));
    draw();
    await vi.advanceTimersByTimeAsync(100);
    let flushed = false;
    const flushing = autosave.flush().then(() => (flushed = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(flushed).toBe(false);
    adapter.gate = null;
    release();
    await flushing;
    expect(flushed).toBe(true);
  });

  it("page deletion: writes the meta without the page, then removes the page", async () => {
    const { autosave, adapter, store } = setup();
    const extra = store.addPage();
    await autosave.flush();
    store.deletePage(extra.id);
    await autosave.flush();
    expect(adapter.deletes).toEqual([[extra.id]]);
    expect(adapter.saves.at(-1)!.meta.pageIds).not.toContain(extra.id);
    expect(adapter.storedPageIds(store.getDocument().id)).not.toContain(extra.id);
  });

  it("an order-only change writes the meta", async () => {
    const { autosave, adapter, store } = setup();
    const extra = store.addPage();
    await autosave.flush();
    store.movePage(extra.id, 0);
    await autosave.flush();
    expect(adapter.saves.at(-1)!.pageIds).toEqual([]);
    expect(adapter.saves.at(-1)!.meta.pageIds[0]).toBe(extra.id);
  });

  it("load does not mark the document dirty", async () => {
    const { autosave, adapter, store } = setup();
    store.load(createDocument());
    expect(autosave.getState().status).toBe("idle");
    await vi.advanceTimersByTimeAsync(5000);
    expect(adapter.saves).toHaveLength(0);
  });

  it("load with pending changes writes the PREVIOUS document first", async () => {
    const { autosave, adapter, draw, store } = setup();
    const before = store.getDocument().id;
    draw();
    const oldDoc = store.getDocument();
    store.load(createDocument());
    await autosave.flush();
    expect(await adapter.load(before)).toEqual(oldDoc);
    expect(await adapter.list()).toEqual([before]);
  });

  it("saveAll writes the whole document (first save)", async () => {
    const { autosave, adapter, store } = setup();
    store.addPage();
    store.load(createDocument({}));
    const doc = store.getDocument();
    await autosave.saveAll();
    expect(await adapter.load(doc.id)).toEqual(doc);
  });

  it("error: error state, flush rejects, retry with backoff and nothing is lost", async () => {
    const { autosave, adapter, draw, store } = setup({ retryDelay: 200 });
    adapter.failNext = 2;
    draw();
    await expect(autosave.flush()).rejects.toThrow("disk full");
    expect(autosave.getState().status).toBe("error");
    await vi.advanceTimersByTimeAsync(200); // 1st retry: fails again
    expect(autosave.getState().status).toBe("error");
    await vi.advanceTimersByTimeAsync(399);
    expect(adapter.saves).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1); // 2nd retry (400 ms): success
    expect(autosave.getState().status).toBe("saved");
    expect(await adapter.load(store.getDocument().id)).toEqual(store.getDocument());
  });

  it("flushes on pagehide and when the tab becomes hidden", async () => {
    const listeners = new Map<string, () => void>();
    let visibility = "visible";
    const fakeWindow = {
      addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type),
      document: {
        get visibilityState() {
          return visibility;
        },
        addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
        removeEventListener: (type: string) => listeners.delete(type),
      },
    } as unknown as Window;
    const { adapter, draw, autosave } = setup({ window: fakeWindow });
    draw();
    visibility = "hidden";
    listeners.get("visibilitychange")!();
    await vi.advanceTimersByTimeAsync(0);
    expect(adapter.saves).toHaveLength(1);
    draw();
    listeners.get("pagehide")!();
    await vi.advanceTimersByTimeAsync(0);
    expect(adapter.saves).toHaveLength(2);
    autosave.destroy();
    expect(listeners.size).toBe(0);
  });

  it("destroy stops observing and is idempotent", async () => {
    const { autosave, adapter, draw } = setup();
    autosave.destroy();
    autosave.destroy();
    draw();
    await vi.advanceTimersByTimeAsync(5000);
    expect(adapter.saves).toHaveLength(0);
    await expect(autosave.flush()).rejects.toThrow();
  });
});
