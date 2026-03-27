import { NextRequest } from "next/server";
import { z } from "zod";
import { storeJob } from "@/lib/server/store";
import { errorResponse } from "@/lib/server/helpers";
import { executePipelineForJob } from "@/lib/server/pipeline-runner";

const createJobSchema = z.object({
  fileIds: z.array(z.string()).min(1),
  // Phase 8A: fileId と floorLabel の対応（オプション）
  files: z.array(z.object({
    fileId: z.string(),
    floorLabel: z.string(),
  })).optional(),
  settings: z.object({
    scale: z.number(),
    floorHeight: z.number(),
  }),
});

/**
 * POST /api/jobs
 *
 * ジョブを作成し、バックグラウンドでパイプラインを実行する。
 *
 * すべてのジョブは実際に Python パイプラインを実行し、
 * その結果に基づいて completed / failed になる。
 * shouldFail のような mock 失敗判定は行わない。
 *
 * ── 責務の境界 ──
 * [Route Handler] リクエスト検証・ジョブ作成・メタデータ保存・レスポンス返却
 * [バックグラウンド] executePipelineForJob() が Python を呼び出し、結果を保存
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

  const { fileIds, files, settings } = parsed.data;

  // files 配列から floorLabels マッピングを構築
  const floorLabels: Record<string, string> | undefined = files
    ? Object.fromEntries(files.map((f) => [f.fileId, f.floorLabel]))
    : undefined;

  const jobId = `job-${Date.now()}`;
  const now = new Date().toISOString();

  storeJob({
    jobId,
    fileIds,
    scale: settings.scale,
    floorHeight: settings.floorHeight,
    createdAt: now,
    floorLabels,
    // ジョブ作成直後は queued 状態。
    // executePipelineForJob() が processing → completed/failed に遷移させる。
    pipelineStatus: "queued",
  });

  // バックグラウンドでパイプラインを実行（fire-and-forget）。
  // 成功でも失敗でも、実際の実行結果に基づいてジョブ状態が更新される。
  // ファイルが見つからない / Python 実行失敗 等は実エラーとして failed になる。
  executePipelineForJob(jobId).catch((err) => {
    console.error(`[POST /api/jobs] Pipeline execution failed for ${jobId}:`, err);
  });

  return Response.json({
    jobId,
    status: "queued",
    fileIds,
    createdAt: now,
  });
}
