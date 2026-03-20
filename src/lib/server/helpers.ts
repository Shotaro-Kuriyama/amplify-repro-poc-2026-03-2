/**
 * Shared helpers for Route Handlers.
 */

import type { ApiErrorPayload } from "@/lib/api/types";

/** Return a JSON error response matching the API error contract. */
export function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>
): Response {
  const body: ApiErrorPayload = { code, message, ...(details && { details }) };
  return Response.json(body, { status });
}
