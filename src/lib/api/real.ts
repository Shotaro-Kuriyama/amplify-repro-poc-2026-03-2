/**
 * Real (fetch-based) API implementation.
 *
 * Calls the Route Handlers via HTTP fetch.
 * Responses are validated by the Zod schemas in client.ts.
 *
 * When connecting to an external backend (FastAPI etc.),
 * only the base URL in endpoints.ts needs to change —
 * this file's fetch logic stays the same.
 */

import type {
  AmplifyAPI,
  CreateJobRequest,
  CreateJobResponse,
  DownloadArtifactRequest,
  DownloadQuantitiesRequest,
  DownloadQuantitiesResponse,
  GetJobResponse,
  SubmitLeadFormRequest,
  SubmitLeadFormResponse,
  UploadPlansRequest,
  UploadPlansResponse,
} from "./types";
import { endpoints } from "./endpoints";
import { ApiError } from "./errors";

/** Throw an ApiError from a non-OK response */
async function handleErrorResponse(res: Response): Promise<never> {
  let body: { code?: string; message?: string } = {};
  try {
    body = await res.json();
  } catch {
    // response body may not be JSON
  }
  throw new ApiError(
    (body.code as import("./errors").ApiErrorCode) ?? "UNKNOWN_ERROR",
    body.message ?? `API error: ${res.status}`,
  );
}

export const realApi: AmplifyAPI = {
  async uploadPlans(req: UploadPlansRequest): Promise<UploadPlansResponse> {
    const formData = new FormData();
    for (const file of req.files) {
      formData.append("files", file);
    }

    const res = await fetch(endpoints.uploadPlans, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) await handleErrorResponse(res);
    return res.json();
  },

  async createAmplifyJob(req: CreateJobRequest): Promise<CreateJobResponse> {
    const res = await fetch(endpoints.createJob, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });

    if (!res.ok) await handleErrorResponse(res);
    return res.json();
  },

  async getAmplifyJob(jobId: string): Promise<GetJobResponse> {
    const res = await fetch(endpoints.getJob(jobId));

    if (!res.ok) await handleErrorResponse(res);
    return res.json();
  },

  async downloadArtifact(req: DownloadArtifactRequest): Promise<Blob> {
    const res = await fetch(
      endpoints.downloadArtifact(req.jobId, req.format)
    );

    if (!res.ok) await handleErrorResponse(res);
    return res.blob();
  },

  async downloadQuantities(
    req: DownloadQuantitiesRequest
  ): Promise<DownloadQuantitiesResponse> {
    const res = await fetch(endpoints.downloadQuantities(req.jobId));

    if (!res.ok) await handleErrorResponse(res);
    return res.json();
  },

  async submitLeadForm(
    req: SubmitLeadFormRequest
  ): Promise<SubmitLeadFormResponse> {
    const res = await fetch(endpoints.submitLeadForm, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });

    if (!res.ok) await handleErrorResponse(res);
    return res.json();
  },
};
