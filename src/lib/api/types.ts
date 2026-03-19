import type {
  AmplifyJob,
  ArtifactFormat,
  ConversionSettings,
  JobArtifact,
  LeadFormData,
  QuantityRow,
} from "@/types";

// ── Request types ──

export interface UploadPlansRequest {
  files: File[];
}

export interface UploadPlansResponse {
  fileIds: string[];
}

export interface CreateJobRequest {
  fileIds: string[];
  settings: ConversionSettings;
}

export interface CreateJobResponse {
  job: AmplifyJob;
}

export interface GetJobResponse {
  job: AmplifyJob;
  artifacts?: JobArtifact[];
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
  data: LeadFormData;
  jobId?: string;
}

// ── API interface ──

export interface AmplifyAPI {
  uploadPlans(req: UploadPlansRequest): Promise<UploadPlansResponse>;
  createAmplifyJob(req: CreateJobRequest): Promise<CreateJobResponse>;
  getAmplifyJob(jobId: string): Promise<GetJobResponse>;
  downloadArtifact(req: DownloadArtifactRequest): Promise<Blob>;
  downloadQuantities(req: DownloadQuantitiesRequest): Promise<DownloadQuantitiesResponse>;
  submitLeadForm(req: SubmitLeadFormRequest): Promise<void>;
}
