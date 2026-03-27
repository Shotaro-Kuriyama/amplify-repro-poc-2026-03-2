/**
 * パイプライン実行のライフサイクル管理。
 *
 * ジョブ作成時に呼び出され、以下の流れを非同期で実行する:
 * 1. ジョブを processing 状態にする
 * 2. PipelineInput を組み立てる
 * 3. Python スクリプトを実行する
 * 4. 最小 IFC artifact を生成する
 * 5. 結果をジョブに保存する（completed or failed）
 *
 * すべてのジョブは実際のパイプライン実行結果に基づいて状態遷移する。
 * shouldFail のような mock 判定は行わない。
 */

import { getJob, storeJob } from "./store";
import { buildPipelineInput, runPipeline } from "./pipeline";
import { attachMinimalIfcArtifact } from "./ifc-generator";

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

  // ── ステップ 1: analyzing_plans — 入力組み立て ──
  job.pipelineStatus = "processing";
  job.pipelineStep = "analyzing_plans";
  storeJob(job);

  let input;
  try {
    input = buildPipelineInput(jobId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "PipelineInput の組み立てに失敗しました";
    job.pipelineStatus = "failed";
    job.pipelineError = { code: "PIPELINE_INPUT_ERROR", message };
    job.completedAt = new Date().toISOString();
    storeJob(job);
    console.error(`[pipeline-runner] Job ${jobId} input error:`, message);
    return;
  }

  // ── ステップ 2: detecting_walls_and_openings — Python 実行 ──
  job.pipelineStep = "detecting_walls_and_openings";
  storeJob(job);

  try {
    const output = await runPipeline(input);

    if (output.success) {
      // ── ステップ 3: building_3d_model — 最小 IFC 生成 ──
      job.pipelineStep = "building_3d_model";
      storeJob(job);

      let outputWithIfc = output;
      try {
        outputWithIfc = await attachMinimalIfcArtifact(jobId, output, input.settings.floorHeight);
      } catch (ifcErr) {
        const message = ifcErr instanceof Error
          ? ifcErr.message
          : "最小 IFC の生成に失敗しました";

        job.pipelineStatus = "failed";
        job.pipelineOutput = output;
        job.pipelineError = { code: "IFC_GENERATION_ERROR", message };
        job.completedAt = new Date().toISOString();
        storeJob(job);

        console.error(`[pipeline-runner] Job ${jobId} IFC generation failed:`, message);
        return;
      }

      // ── ステップ 4: preparing_artifacts → completed ──
      job.pipelineStep = "preparing_artifacts";
      job.pipelineStatus = "completed";
      job.pipelineOutput = outputWithIfc;
      job.completedAt = new Date().toISOString();
      storeJob(job);

      console.log(
        `[pipeline-runner] Job ${jobId} completed:`,
        `walls=${outputWithIfc.stats.totalWalls}`,
        `openings=${outputWithIfc.stats.totalOpenings}`,
        `rooms=${outputWithIfc.stats.totalRooms}`,
        `duration=${outputWithIfc.stats.durationMs}ms`,
        `artifacts=${outputWithIfc.artifacts.map((artifact) => artifact.format).join(",")}`
      );
    } else {
      // Python が success: false を返した
      job.pipelineStatus = "failed";
      job.pipelineOutput = output;
      job.pipelineError = {
        code: output.error?.code ?? "PIPELINE_FAILED",
        message: output.error?.message ?? "パイプライン処理が失敗しました",
      };
      job.completedAt = new Date().toISOString();
      storeJob(job);

      console.error(
        `[pipeline-runner] Job ${jobId} failed (Python returned success=false):`,
        job.pipelineError.message
      );
    }
  } catch (err) {
    // Python プロセス起動失敗 / non-zero 終了 / JSON パース失敗
    const message = err instanceof Error ? err.message : "パイプライン処理中に不明なエラーが発生しました";
    const code = classifyPipelineError(message);

    job.pipelineStatus = "failed";
    job.pipelineError = { code, message };
    job.completedAt = new Date().toISOString();
    storeJob(job);

    console.error(`[pipeline-runner] Job ${jobId} ${code}:`, message);
  }
}
