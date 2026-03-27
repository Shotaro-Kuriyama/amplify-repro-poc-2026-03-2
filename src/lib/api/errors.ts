/**
 * API error codes.
 * Used by both mock and real (Route Handlers / pipeline-runner) implementations.
 */
export const API_ERROR_CODES = {
  // ── 共通 ──
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNSUPPORTED_FILE_TYPE: "UNSUPPORTED_FILE_TYPE",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  UPLOAD_FAILED: "UPLOAD_FAILED",
  JOB_NOT_FOUND: "JOB_NOT_FOUND",
  DOWNLOAD_NOT_READY: "DOWNLOAD_NOT_READY",
  UNKNOWN_ERROR: "UNKNOWN_ERROR",

  // ── mock 専用 ──
  PROCESSING_FAILED: "PROCESSING_FAILED",

  // ── パイプライン系（real モード） ──
  PIPELINE_INPUT_ERROR: "PIPELINE_INPUT_ERROR",
  PIPELINE_EXECUTION_ERROR: "PIPELINE_EXECUTION_ERROR",
  PIPELINE_OUTPUT_PARSE_ERROR: "PIPELINE_OUTPUT_PARSE_ERROR",
  PIPELINE_FAILED: "PIPELINE_FAILED",
  IFC_GENERATION_ERROR: "IFC_GENERATION_ERROR",

  // ── artifact 系（real モード） ──
  ARTIFACT_NOT_FOUND: "ARTIFACT_NOT_FOUND",
  ARTIFACT_INVALID: "ARTIFACT_INVALID",
  ARTIFACT_READ_ERROR: "ARTIFACT_READ_ERROR",
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

/**
 * Structured API error.
 * Thrown by the API client layer when an operation fails.
 * Contains a machine-readable `code` and a human-readable `message`.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ApiErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Normalize any thrown value into an ApiError.
 * Useful in catch blocks to ensure consistent error shape.
 */
export function normalizeError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof Error) {
    return new ApiError("UNKNOWN_ERROR", err.message);
  }
  return new ApiError("UNKNOWN_ERROR", "不明なエラーが発生しました");
}
