/**
 * Phase 8A: パイプライン実行のライフサイクル管理。
 *
 * ジョブ作成時に呼び出され、以下の流れを非同期で実行する:
 * 1. ジョブを processing 状態にする
 * 2. PipelineInput を組み立てる
 * 3. Python スクリプトを実行する
 * 4. 結果をジョブに保存する（completed or failed）
 *
 * この関数は fire-and-forget で呼ばれる想定。
 * POST /api/jobs はジョブ作成後すぐにレスポンスを返し、
 * バックグラウンドでパイプラインが実行される。
 */

import { getJob, storeJob } from "./store";
import { buildPipelineInput, runPipeline } from "./pipeline";

/**
 * 指定されたジョブのパイプラインを非同期で実行する。
 *
 * ジョブの pipelineStatus を更新しながら進行し、
 * 完了時には pipelineOutput を保存する。
 */
export async function executePipelineForJob(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job) {
    console.error(`[pipeline-runner] Job not found: ${jobId}`);
    return;
  }

  // processing に更新
  job.pipelineStatus = "processing";
  storeJob(job);

  try {
    // PipelineInput を組み立てる
    const input = buildPipelineInput(jobId);

    // Python を実行
    const output = await runPipeline(input);

    // 結果を保存
    const updatedJob = getJob(jobId);
    if (!updatedJob) return; // ジョブが消えた場合（通常起きない）

    if (output.success) {
      updatedJob.pipelineStatus = "completed";
      updatedJob.pipelineOutput = output;
      updatedJob.completedAt = new Date().toISOString();
    } else {
      updatedJob.pipelineStatus = "failed";
      updatedJob.pipelineOutput = output;
      updatedJob.pipelineError = {
        code: output.error?.code ?? "PIPELINE_FAILED",
        message: output.error?.message ?? "パイプライン処理が失敗しました",
      };
    }
    storeJob(updatedJob);

    console.log(
      `[pipeline-runner] Job ${jobId} ${updatedJob.pipelineStatus}:`,
      `walls=${output.stats.totalWalls}`,
      `openings=${output.stats.totalOpenings}`,
      `rooms=${output.stats.totalRooms}`,
      `duration=${output.stats.durationMs}ms`
    );
  } catch (err) {
    // Python 実行失敗 / JSON パース失敗 等
    const updatedJob = getJob(jobId);
    if (!updatedJob) return;

    const message = err instanceof Error ? err.message : "パイプライン処理中に不明なエラーが発生しました";
    updatedJob.pipelineStatus = "failed";
    updatedJob.pipelineError = {
      code: "PIPELINE_EXECUTION_ERROR",
      message,
    };
    storeJob(updatedJob);

    console.error(`[pipeline-runner] Job ${jobId} failed:`, message);
  }
}
