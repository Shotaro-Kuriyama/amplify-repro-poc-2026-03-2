import { NextRequest } from "next/server";
import { getJob, computeJobState } from "@/lib/server/store";
import { errorResponse } from "@/lib/server/helpers";

const VALID_FORMATS = ["ifc", "rvt", "dwg"];

/**
 * GET /api/jobs/:jobId/artifacts/:format
 *
 * Download a generated artifact file.
 * Returns the file directly as a binary response (案A: 直接ファイルレスポンス).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string; format: string }> }
) {
  const { jobId, format } = await params;

  if (!VALID_FORMATS.includes(format)) {
    return errorResponse(400, "VALIDATION_ERROR", `不正なフォーマット: ${format}`);
  }

  const job = getJob(jobId);
  if (!job) {
    return errorResponse(404, "JOB_NOT_FOUND", "指定されたジョブが見つかりません");
  }

  const state = computeJobState(job);
  if (state.status !== "completed") {
    return errorResponse(409, "DOWNLOAD_NOT_READY", "ジョブがまだ完了していません");
  }

  // Return a mock binary file
  const content = `mock-artifact-data-${format}`;
  return new Response(content, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="model.${format}"`,
    },
  });
}
