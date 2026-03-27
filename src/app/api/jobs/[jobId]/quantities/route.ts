import { NextRequest } from "next/server";
import { getJob, computeJobState, MOCK_QUANTITIES } from "@/lib/server/store";
import { errorResponse } from "@/lib/server/helpers";

/**
 * GET /api/jobs/:jobId/quantities
 *
 * Download quantities table data for a completed job.
 *
 * Phase 8A: パイプライン結果がある場合は実データから数量を算出する。
 * パイプライン結果がない場合は MOCK_QUANTITIES にフォールバック。
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

  // Phase 8A: パイプライン結果がある場合、実データから数量を算出
  if (job.pipelineOutput) {
    const stats = job.pipelineOutput.stats;
    const rows = [
      { element: "壁", count: stats.totalWalls, unit: "本" },
      { element: "開口部", count: stats.totalOpenings, unit: "箇所" },
      { element: "部屋", count: stats.totalRooms, unit: "室" },
    ];
    return Response.json({ rows });
  }

  return Response.json({ rows: MOCK_QUANTITIES });
}
