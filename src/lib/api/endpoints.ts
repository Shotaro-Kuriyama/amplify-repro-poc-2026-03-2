const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api";

export const endpoints = {
  uploadPlans: `${BASE_URL}/plans/upload`,
  createJob: `${BASE_URL}/jobs`,
  getJob: (jobId: string) => `${BASE_URL}/jobs/${jobId}`,
  downloadArtifact: (jobId: string, format: string) =>
    `${BASE_URL}/jobs/${jobId}/artifacts/${format}`,
  downloadQuantities: (jobId: string) =>
    `${BASE_URL}/jobs/${jobId}/quantities`,
  submitLeadForm: `${BASE_URL}/leads`,
} as const;
