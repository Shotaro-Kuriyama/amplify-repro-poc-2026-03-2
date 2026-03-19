// ── Job lifecycle ──
export type JobStatus =
  | "idle"
  | "uploading"
  | "ready"
  | "processing"
  | "completed"
  | "failed";

// ── File management ──
export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  file: File;
  floor: number;
  label: string; // e.g. "1F", "2F", "B1"
}

// ── Conversion settings ──
export interface ConversionSettings {
  scale: number; // e.g. 100 for 1:100
  floorHeight: number; // meters
  opacity: number; // 0-1 for plan overlay
  cameraMode: "perspective" | "orthographic";
}

// ── Job ──
export interface AmplifyJob {
  id: string;
  status: JobStatus;
  progress: number; // 0-100
  progressStep: number; // current step index
  progressMessage: string;
  createdAt: string;
  completedAt?: string;
  error?: string;
}

// ── Artifacts ──
export type ArtifactFormat = "ifc" | "rvt" | "dwg";

export interface JobArtifact {
  id: string;
  format: ArtifactFormat;
  fileName: string;
  size: number;
}

// ── Lead form ──
export type OrganizationType =
  | "architect"
  | "construction"
  | "bim_service"
  | "real_estate"
  | "government"
  | "education"
  | "other";

export interface LeadFormData {
  name: string;
  email: string;
  country: string;
  organizationType: OrganizationType;
  company: string;
}

// ── Quantity ──
export interface QuantityRow {
  element: string;
  count: number;
  unit: string;
  totalArea?: number;
  totalLength?: number;
}

// ── Processing steps (UI display + mock timing config) ──
export interface ProcessingStepConfig {
  key: string;
  label: string;
  duration: number; // ms for mock polling interval
}
