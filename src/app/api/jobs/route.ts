import { NextRequest } from "next/server";
import { z } from "zod";
import { storeJob, getFile } from "@/lib/server/store";
import { errorResponse } from "@/lib/server/helpers";

const createJobSchema = z.object({
  fileIds: z.array(z.string()).min(1),
  settings: z.object({
    scale: z.number(),
    floorHeight: z.number(),
  }),
});

/**
 * POST /api/jobs
 *
 * Create a new conversion job.
 * Determines fail status from uploaded file names (fail demo).
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "VALIDATION_ERROR", "リクエストボディが不正です");
  }

  const parsed = createJobSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(400, "VALIDATION_ERROR", "入力が不正です", {
      issues: parsed.error.issues,
    });
  }

  const { fileIds, settings } = parsed.data;

  // Determine if this job should fail (file name contains "fail")
  const shouldFail = fileIds.some((id) => {
    const meta = getFile(id);
    return meta ? meta.originalName.toLowerCase().includes("fail") : false;
  });

  const jobId = `job-${Date.now()}`;
  const now = new Date().toISOString();

  storeJob({
    jobId,
    fileIds,
    shouldFail,
    scale: settings.scale,
    floorHeight: settings.floorHeight,
    createdAt: now,
    startedAtMs: Date.now(),
  });

  return Response.json({
    jobId,
    status: "processing",
    fileIds,
    createdAt: now,
  });
}
