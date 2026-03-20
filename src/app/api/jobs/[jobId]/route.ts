import { NextRequest } from "next/server";
import { getJob, computeJobState, MOCK_ARTIFACTS } from "@/lib/server/store";
import { errorResponse } from "@/lib/server/helpers";

/**
 * GET /api/jobs/:jobId
 *
 * Returns current job status, progress, and artifacts (when completed).
 * Progress is computed from elapsed time since job creation.
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

  return Response.json({
    jobId: job.jobId,
    status: state.status,
    progress: state.progress,
    currentStep: state.currentStep,
    artifacts: state.status === "completed" ? MOCK_ARTIFACTS : null,
    quantitiesReady: state.status === "completed",
    error: state.error,
    createdAt: job.createdAt,
    completedAt: state.completedAt,
  });
}
