/**
 * パイプライン実行のライフサイクル管理。
 *
 * ジョブ作成時に呼び出され、以下の流れを非同期で実行する:
 * 1. ジョブを processing 状態にする
 * 2. PipelineInput を組み立てる
 * 3. Python スクリプトを実行する
 * 4. 結果をジョブに保存する（completed or failed）
 *
 * すべてのジョブは実際のパイプライン実行結果に基づいて状態遷移する。
 * shouldFail のような mock 判定は行わない。
 *
 * エラーは原因に応じて以下のコードで区分する:
 * - PIPELINE_INPUT_ERROR: PipelineInput の組み立て失敗（file 不在 / filePath 不在）
 * - PIPELINE_EXECUTION_ERROR: Python プロセス起動失敗 / non-zero 終了
 * - PIPELINE_OUTPUT_PARSE_ERROR: stdout JSON のパース失敗
 * - PIPELINE_FAILED: Python 側が success: false を返したケース
 */

import { getJob, storeJob } from "./store";
import { buildPipelineInput, runPipeline } from "./pipeline";

/**
 * エラーメッセージからエラーコードを推定する。
 *
 * pipeline.ts の runPipeline() が throw するエラーメッセージの内容から、
 * より具体的なエラーコードを割り当てる。
 */
function classifyPipelineError(message: string): string {
  if (message.includes("Failed to parse Python output")) {
    return "PIPELINE_OUTPUT_PARSE_ERROR";
  }
  if (message.includes("Python process failed")) {
    return "PIPELINE_EXECUTION_ERROR";
  }
  return "PIPELINE_EXECUTION_ERROR";
}

/**
 * 指定されたジョブのパイプラインを非同期で実行する。
 *
 * ジョブの pipelineStatus を更新しながら進行し、
 * 完了時には pipelineOutput（成功時）または pipelineError（失敗時）を保存する。
 *
 * この関数は fire-and-forget で呼ばれる想定。
 * POST /api/jobs はジョブ作成後すぐにレスポンスを返し、
 * バックグラウンドでこの関数がパイプラインを実行する。
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

  // Step 1: PipelineInput を組み立てる
  // ファイルが見つからない / filePath がないなどは PIPELINE_INPUT_ERROR になる
  let input;
  try {
    input = buildPipelineInput(jobId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "PipelineInput の組み立てに失敗しました";
    const updatedJob = getJob(jobId);
    if (!updatedJob) return;

    updatedJob.pipelineStatus = "failed";
    updatedJob.pipelineError = {
      code: "PIPELINE_INPUT_ERROR",
      message,
    };
    updatedJob.completedAt = new Date().toISOString();
    storeJob(updatedJob);

    console.error(`[pipeline-runner] Job ${jobId} input error:`, message);
    return;
  }

  // Step 2: Python を実行する
  try {
    const output = await runPipeline(input);

    // 結果を保存
    const updatedJob = getJob(jobId);
    if (!updatedJob) return;

    if (output.success) {
      // 成功: completed
      updatedJob.pipelineStatus = "completed";
      updatedJob.pipelineOutput = output;
      updatedJob.completedAt = new Date().toISOString();

      console.log(
        `[pipeline-runner] Job ${jobId} completed:`,
        `walls=${output.stats.totalWalls}`,
        `openings=${output.stats.totalOpenings}`,
        `rooms=${output.stats.totalRooms}`,
        `duration=${output.stats.durationMs}ms`
      );
    } else {
      // Python が success: false を返した
      updatedJob.pipelineStatus = "failed";
      updatedJob.pipelineOutput = output;
      updatedJob.pipelineError = {
        code: output.error?.code ?? "PIPELINE_FAILED",
        message: output.error?.message ?? "パイプライン処理が失敗しました",
      };
      updatedJob.completedAt = new Date().toISOString();

      console.error(
        `[pipeline-runner] Job ${jobId} failed (Python returned success=false):`,
        updatedJob.pipelineError.message
      );
    }
    storeJob(updatedJob);
  } catch (err) {
    // Python プロセス起動失敗 / non-zero 終了 / JSON パース失敗
    const updatedJob = getJob(jobId);
    if (!updatedJob) return;

    const message = err instanceof Error ? err.message : "パイプライン処理中に不明なエラーが発生しました";
    const code = classifyPipelineError(message);

    updatedJob.pipelineStatus = "failed";
    updatedJob.pipelineError = { code, message };
    updatedJob.completedAt = new Date().toISOString();
    storeJob(updatedJob);

    console.error(`[pipeline-runner] Job ${jobId} ${code}:`, message);
  }
}
