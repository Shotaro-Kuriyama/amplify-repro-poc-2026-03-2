import type { AmplifyAPI } from "./types";
import { mockApi } from "./mock";
import { realApi } from "./real";
import {
  uploadPlansResponseSchema,
  createJobResponseSchema,
  getJobResponseSchema,
  downloadQuantitiesResponseSchema,
  submitLeadFormResponseSchema,
} from "./schemas";

/**
 * Wrap an API implementation with Zod runtime validation.
 *
 * This ensures that responses conform to the API contract at runtime,
 * catching shape mismatches early — both during mock development and
 * when switching to a real backend that might return unexpected data.
 */
function createValidatedApi(impl: AmplifyAPI): AmplifyAPI {
  return {
    async uploadPlans(req) {
      const raw = await impl.uploadPlans(req);
      return uploadPlansResponseSchema.parse(raw);
    },
    async createAmplifyJob(req) {
      const raw = await impl.createAmplifyJob(req);
      return createJobResponseSchema.parse(raw);
    },
    async getAmplifyJob(jobId) {
      const raw = await impl.getAmplifyJob(jobId);
      return getJobResponseSchema.parse(raw);
    },
    async downloadArtifact(req) {
      // Blob responses don't need schema validation
      return impl.downloadArtifact(req);
    },
    async downloadQuantities(req) {
      const raw = await impl.downloadQuantities(req);
      return downloadQuantitiesResponseSchema.parse(raw);
    },
    async submitLeadForm(req) {
      const raw = await impl.submitLeadForm(req);
      return submitLeadFormResponseSchema.parse(raw);
    },
  };
}

/**
 * API mode selection.
 *
 * - "mock"  : Direct function calls to mock.ts (no network, Phase 6 behavior)
 * - "real"  : HTTP fetch to Route Handlers (/api/*) backed by in-memory store
 *
 * Set via NEXT_PUBLIC_API_MODE environment variable.
 * Default: "real" (uses Route Handlers)
 */
const apiMode = process.env.NEXT_PUBLIC_API_MODE ?? "real";

const baseImpl: AmplifyAPI = apiMode === "mock" ? mockApi : realApi;

/**
 * API client — Zod-validated, mode-switchable.
 *
 * Switch between mock and real by setting:
 *   NEXT_PUBLIC_API_MODE=mock   → direct mock calls (no HTTP)
 *   NEXT_PUBLIC_API_MODE=real   → fetch to /api/* Route Handlers
 */
export const api: AmplifyAPI = createValidatedApi(baseImpl);
