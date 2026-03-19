/**
 * API error codes.
 * Used by both mock and future backend implementations.
 */
export const API_ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNSUPPORTED_FILE_TYPE: "UNSUPPORTED_FILE_TYPE",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  UPLOAD_FAILED: "UPLOAD_FAILED",
  JOB_NOT_FOUND: "JOB_NOT_FOUND",
  JOB_NOT_READY: "JOB_NOT_READY",
  PROCESSING_FAILED: "PROCESSING_FAILED",
  DOWNLOAD_NOT_READY: "DOWNLOAD_NOT_READY",
  LEAD_SUBMISSION_FAILED: "LEAD_SUBMISSION_FAILED",
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
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
