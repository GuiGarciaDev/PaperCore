import type { PaperDocument, PaperPage, Size } from "../core/types.js";

/**
 * Dados do documento que não pertencem a nenhuma página. `pageIds` é a fonte da verdade da
 * ordem e de quais páginas existem: páginas gravadas que não estão nela são ignoradas no
 * carregamento (por exemplo, se o app fechou entre `savePages` e `deletePages`).
 */
export interface DocumentMeta {
  readonly id: string;
  readonly schemaVersion: number;
  readonly defaultPageSize: Size;
  readonly pageIds: readonly string[];
  /** `Date.now()` do último salvamento. */
  readonly savedAt: number;
}

/**
 * Onde os documentos são gravados (ADR-0008). O motor salva por página: a aplicação pode
 * implementar o próprio adaptador (por exemplo, gravar localmente e enfileirar para o servidor).
 *
 * Contrato:
 * - `savePages` grava as páginas recebidas **e** a meta, de preferência de forma atômica.
 * - `load` devolve o documento montado na ordem de `meta.pageIds`, ou `null` se não existir.
 *   Pode lançar `PaperCoreError` (`STORAGE_CORRUPTED`) se faltar uma página listada.
 */
export interface StorageAdapter {
  load(documentId: string): Promise<PaperDocument | null>;
  savePages(documentId: string, pages: readonly PaperPage[], meta: DocumentMeta): Promise<void>;
  deletePages(documentId: string, pageIds: readonly string[]): Promise<void>;
  deleteDocument(documentId: string): Promise<void>;
  /** Ids dos documentos gravados. */
  list(): Promise<string[]>;
}
