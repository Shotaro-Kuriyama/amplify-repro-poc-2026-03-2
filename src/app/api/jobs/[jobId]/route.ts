import path from "path";
import { NextRequest } from "next/server";
import { getJob, computeJobState, MOCK_ARTIFACTS } from "@/lib/server/store";
import { errorResponse } from "@/lib/server/helpers";

/**
 * GET /api/jobs/:jobId
 *
 * Returns current job status, progress, and artifacts (when completed).
 *
 * Phase 8A: パイプラインが実行されたジョブの場合、実際の結果を返す。
 * pipelineResult フィールドに構造化 JSON の内容が含まれる。
 *
 * ── 責務の境界 ──
 * [Route Handler に残る] ジョブ状態の問い合わせ・レスポンス整形
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

  // Phase 8A: パイプライン結果がある場合はそれを返す
  // パイプライン結果がない場合はモックデータにフォールバック
  const hasRealResults = !!job.pipelineOutput;
  const artifacts = state.status === "completed"
    ? (hasRealResults
        ? job.pipelineOutput!.artifacts.map((a, i) => ({
            id: `artifact-${i}`,
            format: a.format,
            fileName: a.filePath === "(inline)"
              ? "structured.json"
              : path.basename(a.filePath),
            size: a.size,
          }))
        : MOCK_ARTIFACTS)
    : null;

  // Phase 8A: pipelineResult にパイプラインの構造化 JSON を含める
  const pipelineResult = job.pipelineOutput
    ? {
        success: job.pipelineOutput.success,
        floors: job.pipelineOutput.floors,
        stats: job.pipelineOutput.stats,
        artifacts: job.pipelineOutput.artifacts,
      }
    : null;

  return Response.json({
    jobId: job.jobId,
    status: state.status,
    progress: state.progress,
    currentStep: state.currentStep,
    artifacts,
    quantitiesReady: state.status === "completed",
    error: state.error,
    createdAt: job.createdAt,
    completedAt: state.completedAt,
    pipelineResult,
  });
}
