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
  ["memória", () => new MemoryStorageAdapter()],
  // Cada teste usa uma fábrica nova: bancos isolados.
  ["IndexedDB", () => new IndexedDbStorageAdapter({ indexedDB: new IDBFactory() })],
];

describe.each(adapters)("adaptador de %s", (_name, make) => {
  it("load devolve null para documento inexistente", async () => {
    expect(await make().load("nope")).toBeNull();
  });

  it("round-trip exato do documento inteiro", async () => {
    const adapter = make();
    const doc = sampleDoc();
    await saveWhole(adapter, doc);
    expect(await adapter.load(doc.id)).toEqual(doc);
    expect(await adapter.list()).toEqual([doc.id]);
  });

  it("salva só as páginas sujas e respeita a ordem da meta", async () => {
    const adapter = make();
    const doc = sampleDoc();
    await saveWhole(adapter, doc);
    const [a, b, c] = doc.pages;
    const changedB = { ...b!, elements: [stroke()] };
    const next = { ...doc, pages: [c!, changedB, a!] };
    await adapter.savePages(doc.id, [changedB], documentMeta(next));
    expect(await adapter.load(doc.id)).toEqual(next);
  });

  it("ignora páginas órfãs (gravadas mas fora da meta)", async () => {
    const adapter = make();
    const doc = sampleDoc();
    await saveWhole(adapter, doc);
    const withoutLast = { ...doc, pages: doc.pages.slice(0, 2) };
    // Meta gravada, mas o app "fechou" antes do deletePages.
    await adapter.savePages(doc.id, [], documentMeta(withoutLast));
    expect(await adapter.load(doc.id)).toEqual(withoutLast);
    await adapter.deletePages(doc.id, [doc.pages[2]!.id]);
    expect(await adapter.load(doc.id)).toEqual(withoutLast);
  });

  it("acusa STORAGE_CORRUPTED se faltar uma página listada", async () => {
    const adapter = make();
    const doc = sampleDoc();
    await saveWhole(adapter, doc);
    await adapter.deletePages(doc.id, [doc.pages[1]!.id]);
    await expect(adapter.load(doc.id)).rejects.toMatchObject({ code: "STORAGE_CORRUPTED" });
  });

  it("deleteDocument remove meta e páginas, sem afetar outros documentos", async () => {
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

  it("o que foi gravado não muda se o objeto original for alterado depois", async () => {
    const adapter = make();
    const doc = sampleDoc();
    await saveWhole(adapter, doc);
    (doc.pages[0]!.elements[0]!.points as number[])[0] = 999;
    const loaded = await adapter.load(doc.id);
    expect(loaded!.pages[0]!.elements[0]!.points[0]).not.toBe(999);
  });
});

describe("IndexedDbStorageAdapter", () => {
  it("sem IndexedDB no ambiente, rejeita com STORAGE_UNAVAILABLE (sem quebrar no import)", async () => {
    const adapter = new IndexedDbStorageAdapter({ indexedDB: undefined });
    await expect(adapter.list()).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
  });

  it("dados persistem entre instâncias (mesmo banco)", async () => {
    const factory = new IDBFactory();
    const doc = sampleDoc();
    const first = new IndexedDbStorageAdapter({ indexedDB: factory });
    await saveWhole(first, doc);
    first.close();
    const second = new IndexedDbStorageAdapter({ indexedDB: factory });
    expect(await second.load(doc.id)).toEqual(doc);
  });
});
