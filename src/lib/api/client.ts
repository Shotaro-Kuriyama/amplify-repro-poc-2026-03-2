import type { AmplifyAPI } from "./types";
import { mockApi } from "./mock";
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
 * API client.
 *
 * Currently dispatches to mock implementations with runtime validation.
 * To connect a real backend, replace `mockApi` with an implementation
 * that calls actual endpoints defined in `./endpoints.ts`.
 * The same Zod validation will verify the real backend's responses.
 */
export const api: AmplifyAPI = createValidatedApi(mockApi);
