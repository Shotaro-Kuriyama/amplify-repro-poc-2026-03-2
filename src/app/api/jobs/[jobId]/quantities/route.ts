import { NextRequest } from "next/server";
import { getJob, computeJobState, MOCK_QUANTITIES } from "@/lib/server/store";
import { errorResponse } from "@/lib/server/helpers";

/**
 * GET /api/jobs/:jobId/quantities
 *
 * Download quantities table data for a completed job.
 *
 * ── 責務の境界 ──
 * [Route Handler に残る] 前提条件チェック・数量データ返却
 * [将来 Worker へ移す]  なし（データ返却は Route Handler の責務）
 *   → Phase 8A 以降は Worker が算出した実際の数量データを DB/ストレージから読む形に変わる
 *   → 現在は MOCK_QUANTITIES を直接返している
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
