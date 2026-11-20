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

/** Standard PaperCore error. Use `code` to handle specific cases. */
export class PaperCoreError extends Error {
  readonly code: PaperCoreErrorCode;
  /** Human-readable details (for example, the list of validation problems). */
  readonly details: readonly string[];

  constructor(code: PaperCoreErrorCode, message: string, details: readonly string[] = []) {
    super(message);
    this.name = "PaperCoreError";
    this.code = code;
    this.details = details;
  }
}
