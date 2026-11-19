import { Emitter } from "../core/emitter.js";
import { PaperCoreError } from "../core/errors.js";
import type { DocumentChange } from "../core/store.js";
import type { PaperDocument } from "../core/types.js";
import { documentMeta } from "./documentParts.js";
import type { StorageAdapter } from "./types.js";

/**
 * - `idle`: nada foi alterado desde o início (ou desde o último `load`).
 * - `dirty`: há mudanças esperando o debounce.
 * - `saving`: gravando no adaptador.
 * - `saved`: tudo gravado no adaptador (NÃO significa sincronizado com servidor).
 * - `error`: a última gravação falhou; nova tentativa agendada.
 */
export type AutosaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export interface AutosaveState {
  readonly status: AutosaveStatus;
  /** Erro da última tentativa, se `status === "error"`. */
  readonly error: unknown;
  /** Momento (`Date.now()`) do último salvamento bem-sucedido. */
  readonly lastSavedAt: number | null;
}

/** O que o autosave precisa da engine (a engine e o `PaperStore` já servem). */
export interface AutosaveSource {
  getDocument(): PaperDocument;
  on(type: "change", listener: (change: DocumentChange) => void): () => void;
}

export interface AutosaveOptions {
  /** Espera depois da última mudança (ms). Padrão: 800. */
  delay?: number;
  /** Com mudanças contínuas, salva no máximo depois deste tempo (ms). Padrão: 5000. */
  maxWait?: number;
  /** Primeira espera depois de uma falha; dobra a cada falha, até 30 s. Padrão: 1000. */
  retryDelay?: number;
  /**
   * Janela para o flush em `visibilitychange`/`pagehide`. Padrão: `globalThis` quando houver
   * `document`. Passe `null` para desligar.
   */
  window?: Window | null;
}

export interface Autosave {
  getState(): AutosaveState;
  on(type: "state", listener: (state: AutosaveState) => void): () => void;
  /**
   * Grava agora tudo o que mudou até este momento. Rejeita se a gravação falhar.
   * Use antes de ações que dependem do documento salvo (por exemplo, enviar uma resposta).
   */
  flush(): Promise<void>;
  /** Marca o documento inteiro como sujo e grava (para o primeiro salvamento ou após importar). */
  saveAll(): Promise<void>;
  /** Para de observar. Mudanças ainda não gravadas são descartadas: chame `flush()` antes. */
  destroy(): void;
}

/** Lote de mudanças de um documento. `generation` é a da última mudança incluída. */
interface Batch {
  doc: PaperDocument;
  dirty: Set<string>;
  deleted: Set<string>;
  generation: number;
}

const MAX_RETRY_DELAY = 30_000;

/**
 * Autosave por página (ADR-0008). Cada mudança incrementa a "geração". Um salvamento só leva o
 * estado para `saved` se, ao terminar, nenhuma mudança tiver chegado enquanto ele gravava; caso
 * contrário o estado volta para `dirty` e outro salvamento é agendado. Assim nunca aparece
 * `saved` com mudanças pendentes.
 *
 * `reason: "load"` não suja o documento. Se houver mudanças pendentes do documento anterior, elas
 * são gravadas antes (o lote guarda o snapshot imutável do documento antigo).
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

  // ── Mudanças ─────────────────────────────────────────────────────────────

  private onChange(change: DocumentChange): void {
    if (this.destroyed) return;
    if (change.reason === "load") {
      // O documento anterior pode ter mudanças pendentes: grava-as (com o snapshot antigo) já.
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
    // Mudança só de ordem: a meta (pageIds) é gravada junto de qualquer lote.
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

  /** Fecha o lote aberto e o põe na fila de gravação. */
  private seal(): void {
    if (!this.open) return;
    this.queue.push(this.open);
    this.open = null;
    this.firstPendingAt = null;
  }

  // ── Gravação ─────────────────────────────────────────────────────────────

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
        // Meta e páginas primeiro; depois as exclusões. Se o app fechar no meio, a meta já não
        // lista as páginas excluídas, e o carregamento as ignora.
        await this.adapter.savePages(doc.id, pages, documentMeta(doc, savedAt));
        if (batch.deleted.size > 0) await this.adapter.deletePages(doc.id, [...batch.deleted]);
        this.queue.splice(0, count);
        this.savedGeneration = Math.max(this.savedGeneration, batch.generation);
        this.failures = 0;
        this.state = { ...this.state, lastSavedAt: savedAt };
      } catch (error) {
        if (this.destroyed) return;
        // Mantém os lotes na fila (já mesclados) e tenta de novo mais tarde.
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

  /** Junta os lotes do início da fila que são do mesmo documento. */
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

  // ── Saída da página ──────────────────────────────────────────────────────

  private readonly onLeave = (): void => {
    if (this.destroyed) return;
    this.clearTimer();
    this.seal();
    void this.run();
  };

  private readonly onVisibility = (): void => {
    if (this.view?.document.visibilityState === "hidden") this.onLeave();
  };

  // ── Utilidades ───────────────────────────────────────────────────────────

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
    if (this.destroyed) throw new PaperCoreError("INVALID_ARGUMENT", "O autosave já foi destruído.");
  }
}

function toError(error: unknown): unknown {
  return error instanceof Error ? error : new PaperCoreError("STORAGE_ERROR", String(error));
}
