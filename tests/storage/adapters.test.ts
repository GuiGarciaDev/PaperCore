import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { createDocument, createPage } from "../../src/core/document.js";
import type { PaperDocument } from "../../src/core/types.js";
import { documentMeta } from "../../src/storage/documentParts.js";
import { IndexedDbStorageAdapter } from "../../src/storage/indexedDbAdapter.js";
import { MemoryStorageAdapter } from "../../src/storage/memoryAdapter.js";
import type { StorageAdapter } from "../../src/storage/types.js";
import { stroke } from "../helpers.js";

function sampleDoc(): PaperDocument {
  const doc = createDocument();
  const first = { ...doc.pages[0]!, elements: [stroke()] };
  return { ...doc, pages: [first, createPage(), createPage()] };
}

async function saveWhole(adapter: StorageAdapter, doc: PaperDocument) {
  await adapter.savePages(doc.id, doc.pages, documentMeta(doc));
}

const adapters: [string, () => StorageAdapter][] = [
  ["memory", () => new MemoryStorageAdapter()],
  // Every test uses a fresh factory: isolated databases.
  ["IndexedDB", () => new IndexedDbStorageAdapter({ indexedDB: new IDBFactory() })],
];

describe.each(adapters)("%s adapter", (_name, make) => {
  it("load returns null for an unknown document", async () => {
    expect(await make().load("nope")).toBeNull();
  });

  it("exact round-trip of the whole document", async () => {
    const adapter = make();
    const doc = sampleDoc();
    await saveWhole(adapter, doc);
    expect(await adapter.load(doc.id)).toEqual(doc);
    expect(await adapter.list()).toEqual([doc.id]);
  });

  it("saves only dirty pages and respects the meta order", async () => {
    const adapter = make();
    const doc = sampleDoc();
    await saveWhole(adapter, doc);
    const [a, b, c] = doc.pages;
    const changedB = { ...b!, elements: [stroke()] };
    const next = { ...doc, pages: [c!, changedB, a!] };
    await adapter.savePages(doc.id, [changedB], documentMeta(next));
    expect(await adapter.load(doc.id)).toEqual(next);
  });

  it("ignores orphan pages (stored but not in the meta)", async () => {
    const adapter = make();
    const doc = sampleDoc();
    await saveWhole(adapter, doc);
    const withoutLast = { ...doc, pages: doc.pages.slice(0, 2) };
    // Meta written, but the app "closed" before deletePages.
    await adapter.savePages(doc.id, [], documentMeta(withoutLast));
    expect(await adapter.load(doc.id)).toEqual(withoutLast);
    await adapter.deletePages(doc.id, [doc.pages[2]!.id]);
    expect(await adapter.load(doc.id)).toEqual(withoutLast);
  });

  it("reports STORAGE_CORRUPTED if a listed page is missing", async () => {
    const adapter = make();
    const doc = sampleDoc();
    await saveWhole(adapter, doc);
    await adapter.deletePages(doc.id, [doc.pages[1]!.id]);
    await expect(adapter.load(doc.id)).rejects.toMatchObject({ code: "STORAGE_CORRUPTED" });
  });

  it("deleteDocument removes meta and pages without affecting other documents", async () => {
    const adapter = make();
    const one = sampleDoc();
    const two = sampleDoc();
    await saveWhole(adapter, one);
    await saveWhole(adapter, two);
    await adapter.deleteDocument(one.id);
    expect(await adapter.load(one.id)).toBeNull();
    expect(await adapter.load(two.id)).toEqual(two);
    expect(await adapter.list()).toEqual([two.id]);
  });

  it("what was stored does not change if the original object is mutated later", async () => {
    const adapter = make();
    const doc = sampleDoc();
    await saveWhole(adapter, doc);
    (doc.pages[0]!.elements[0]!.points as number[])[0] = 999;
    const loaded = await adapter.load(doc.id);
    expect(loaded!.pages[0]!.elements[0]!.points[0]).not.toBe(999);
  });
});

describe("IndexedDbStorageAdapter", () => {
  it("without IndexedDB in the environment, rejects with STORAGE_UNAVAILABLE (without breaking on import)", async () => {
    const adapter = new IndexedDbStorageAdapter({ indexedDB: undefined });
    await expect(adapter.list()).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
  });

  it("data persists across instances (same database)", async () => {
    const factory = new IDBFactory();
    const doc = sampleDoc();
    const first = new IndexedDbStorageAdapter({ indexedDB: factory });
    await saveWhole(first, doc);
    first.close();
    const second = new IndexedDbStorageAdapter({ indexedDB: factory });
    expect(await second.load(doc.id)).toEqual(doc);
  });
});
