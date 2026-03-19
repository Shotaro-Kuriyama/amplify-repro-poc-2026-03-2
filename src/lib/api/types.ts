import type { ArtifactFormat, QuantityRow } from "@/types";

// ── API domain types (backend concepts) ──

/** Job status as returned by the backend API */
export type ApiJobStatus = "queued" | "processing" | "completed" | "failed";

/** Processing step identifiers — backend reports which step the job is in */
export type ApiProcessingStep =
  | "analyzing_plans"
  | "detecting_walls_and_openings"
  | "building_3d_model"
  | "preparing_artifacts";

/** Standardized API error payload */
export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/** File metadata returned after upload */
export interface UploadedFileMeta {
  fileId: string;
  originalName: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
}

/** Artifact metadata within a job response */
export interface ApiJobArtifact {
  id: string;
  format: ArtifactFormat;
  fileName: string;
  size: number;
}

// ── Request / Response types ──

export interface UploadPlansRequest {
  files: File[];
}

export interface UploadPlansResponse {
  files: UploadedFileMeta[];
}

export interface CreateJobRequest {
  fileIds: string[];
  settings: {
    scale: number;
    floorHeight: number;
  };
}

export interface CreateJobResponse {
  jobId: string;
  status: ApiJobStatus;
  fileIds: string[];
  createdAt: string;
}

export interface GetJobResponse {
  jobId: string;
  status: ApiJobStatus;
  progress: number;
  currentStep: ApiProcessingStep | null;
  artifacts: ApiJobArtifact[] | null;
  quantitiesReady: boolean;
  error: ApiErrorPayload | null;
  createdAt: string;
  completedAt: string | null;
}

export interface DownloadArtifactRequest {
  jobId: string;
  format: ArtifactFormat;
}

export interface DownloadQuantitiesRequest {
  jobId: string;
}

export interface DownloadQuantitiesResponse {
  rows: QuantityRow[];
}

export interface SubmitLeadFormRequest {
  data: {
    name: string;
    email: string;
    country: string;
    organizationType: string;
    company: string;
  };
  jobId: string;
}

export interface SubmitLeadFormResponse {
  submissionId: string;
  submittedAt: string;
}

// ── API interface ──

export interface AmplifyAPI {
  uploadPlans(req: UploadPlansRequest): Promise<UploadPlansResponse>;
  createAmplifyJob(req: CreateJobRequest): Promise<CreateJobResponse>;
  getAmplifyJob(jobId: string): Promise<GetJobResponse>;
  downloadArtifact(req: DownloadArtifactRequest): Promise<Blob>;
  downloadQuantities(req: DownloadQuantitiesRequest): Promise<DownloadQuantitiesResponse>;
  submitLeadForm(req: SubmitLeadFormRequest): Promise<SubmitLeadFormResponse>;
}
