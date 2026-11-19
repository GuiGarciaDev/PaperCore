import { POINT_STRIDE, quantize } from "../../core/config.js";
import { strokeOutline } from "../../core/geometry/strokeOutline.js";
import { createId } from "../../core/ids.js";
import { addElementsOperation } from "../../core/operations.js";
import type { Size, StrokeElement, StrokeStyle } from "../../core/types.js";
import type { InputSample } from "../input.js";
import type { Tool, ToolContext } from "./types.js";

/** Distância mínima entre pontos capturados, em pixels de TELA (ADR-0005). */
export const MIN_POINT_DISTANCE_PX = 0.75;

interface Draft {
  pageId: string;
  pageSize: Size;
  style: StrokeStyle;
  hasPressure: boolean;
  points: number[];
  /** Última amostra recebida (mesmo se descartada pelo filtro), para fechar o traço no ponto exato. */
  pending: InputSample | null;
  /** `true` quando este rascunho continua um traço que atingiu o limite de pontos. */
  continuation: boolean;
}

export class PenTool implements Tool {
  readonly name = "pen" as const;
  private draft: Draft | null = null;

  constructor(private readonly ctx: ToolContext) {}

  isDrawing(): boolean {
    return this.draft !== null;
  }

  begin(sample: InputSample): void {
    const pageId = this.ctx.getActivePageId();
    const page = this.ctx.store.getPage(pageId);
    this.draft = {
      pageId,
      pageSize: page.size,
      style: { ...this.ctx.getSettings().pen },
      hasPressure: sample.hasPressure,
      points: [],
      pending: null,
      continuation: false,
    };
    this.push(sample);
    this.renderLive();
  }

  move(samples: readonly InputSample[]): void {
    if (!this.draft) return;
    const minDistance = MIN_POINT_DISTANCE_PX / this.ctx.getTransform().scale;
    for (const sample of samples) {
      // Lido a cada iteração: `push` pode trocar o rascunho ao continuar o traço (limite de pontos).
      const draft = this.draft;
      if (!draft) return;
      const n = draft.points.length;
      const dx = sample.x - draft.points[n - POINT_STRIDE]!;
      const dy = sample.y - draft.points[n - POINT_STRIDE + 1]!;
      if (dx * dx + dy * dy < minDistance * minDistance) {
        draft.pending = sample;
        continue;
      }
      this.push(sample);
    }
    this.renderLive();
  }

  end(): void {
    if (!this.draft) return;
    if (this.draft.pending) this.push(this.draft.pending);
    const draft = this.draft;
    // Uma continuação que só tem o ponto de junção não acrescenta tinta.
    if (!(draft.continuation && draft.points.length === POINT_STRIDE)) this.commit(draft);
    this.draft = null;
    this.ctx.setLiveStroke(null);
  }

  cancel(): void {
    this.draft = null;
    this.ctx.setLiveStroke(null);
  }

  private push(sample: InputSample): void {
    const draft = this.draft;
    if (!draft) return;
    draft.pending = null;
    // Pontos fora da página são recortados na borda (o validador exige pontos dentro da página).
    const x = quantize(Math.min(draft.pageSize.width, Math.max(0, sample.x)));
    const y = quantize(Math.min(draft.pageSize.height, Math.max(0, sample.y)));
    const p = quantize(sample.pressure);
    draft.points.push(x, y, p);

    // Limite de pontos: em vez de descartar tinta, confirma este traço e continua em um novo
    // a partir do último ponto.
    if (draft.points.length / POINT_STRIDE >= this.ctx.limits.maxPointsPerStroke) {
      this.commit(draft);
      this.draft = { ...draft, points: [x, y, p], pending: null, continuation: true };
    }
  }

  private commit(draft: Draft): void {
    if (draft.points.length === 0) return;
    const element: StrokeElement = {
      id: createId(),
      type: "stroke",
      style: draft.style,
      hasPressure: draft.hasPressure,
      points: draft.points,
    };
    const store = this.ctx.store;
    if (!store.hasPage(draft.pageId) || store.isReadOnly()) return;
    store.apply(addElementsOperation(store.getPage(draft.pageId), [element]));
  }

  private renderLive(): void {
    const draft = this.draft;
    if (!draft) return;
    const points = draft.pending
      ? [...draft.points, draft.pending.x, draft.pending.y, draft.pending.pressure]
      : draft.points;
    this.ctx.setLiveStroke({
      geometry: strokeOutline(points, draft.style.width, draft.hasPressure),
      color: draft.style.color,
    });
  }
}
