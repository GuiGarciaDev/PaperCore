export type PaperCoreErrorCode =
  | "INVALID_DOCUMENT"
  | "UNSUPPORTED_VERSION"
  | "IMPORT_TOO_LARGE"
  | "INVALID_JSON"
  | "READ_ONLY"
  | "PAGE_NOT_FOUND"
  | "LAST_PAGE"
  | "LIMIT_EXCEEDED"
  | "INVALID_ARGUMENT"
  | "INCONSISTENT_OPERATION"
  | "STORAGE_UNAVAILABLE"
  | "STORAGE_QUOTA_EXCEEDED"
  | "STORAGE_CORRUPTED"
  | "STORAGE_ERROR";

/** Erro padronizado do PaperCore. Use `code` para tratar casos específicos. */
export class PaperCoreError extends Error {
  readonly code: PaperCoreErrorCode;
  /** Detalhes legíveis (por exemplo, a lista de problemas de validação). */
  readonly details: readonly string[];

  constructor(code: PaperCoreErrorCode, message: string, details: readonly string[] = []) {
    super(message);
    this.name = "PaperCoreError";
    this.code = code;
    this.details = details;
  }
}
