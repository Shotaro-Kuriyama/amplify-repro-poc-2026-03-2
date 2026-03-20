import { NextRequest } from "next/server";
import { getJob, computeJobState, MOCK_QUANTITIES } from "@/lib/server/store";
import { errorResponse } from "@/lib/server/helpers";

/**
 * GET /api/jobs/:jobId/quantities
 *
 * Download quantities table data for a completed job.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;

  const job = getJob(jobId);
  if (!job) {
    return errorResponse(404, "JOB_NOT_FOUND", "指定されたジョブが見つかりません");
  }

  const state = computeJobState(job);
  if (state.status !== "completed") {
    return errorResponse(409, "DOWNLOAD_NOT_READY", "ジョブがまだ完了していません");
  }

  return Response.json({ rows: MOCK_QUANTITIES });
}
