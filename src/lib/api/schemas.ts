import { z } from "zod";

// ── API domain schemas ──

export const apiJobStatusSchema = z.enum([
  "queued",
  "processing",
  "completed",
  "failed",
]);

export const apiProcessingStepSchema = z.enum([
  "analyzing_plans",
  "detecting_walls_and_openings",
  "building_3d_model",
  "preparing_artifacts",
]);

export const artifactFormatSchema = z.enum(["ifc", "rvt", "dwg"]);

export const apiErrorPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

// ── Response schemas ──

export const uploadPlansResponseSchema = z.object({
  files: z.array(
    z.object({
      fileId: z.string(),
      originalName: z.string(),
      size: z.number(),
      mimeType: z.string(),
      uploadedAt: z.string(),
    })
  ),
});

export const createJobResponseSchema = z.object({
  jobId: z.string(),
  status: apiJobStatusSchema,
  fileIds: z.array(z.string()),
  createdAt: z.string(),
});

export const getJobResponseSchema = z.object({
  jobId: z.string(),
  status: apiJobStatusSchema,
  progress: z.number().min(0).max(100),
  currentStep: apiProcessingStepSchema.nullable(),
  artifacts: z
    .array(
      z.object({
        id: z.string(),
        format: artifactFormatSchema,
        fileName: z.string(),
        size: z.number(),
      })
    )
    .nullable(),
  quantitiesReady: z.boolean(),
  error: apiErrorPayloadSchema.nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});

export const downloadQuantitiesResponseSchema = z.object({
  rows: z.array(
    z.object({
      element: z.string(),
      count: z.number(),
      unit: z.string(),
      totalArea: z.number().optional(),
      totalLength: z.number().optional(),
    })
  ),
});

export const submitLeadFormResponseSchema = z.object({
  submissionId: z.string(),
  submittedAt: z.string(),
});
