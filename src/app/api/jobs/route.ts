import { NextRequest } from "next/server";
import { z } from "zod";
import { storeJob, getFile } from "@/lib/server/store";
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
 * Create a new conversion job and trigger the pipeline.
 *
 * Phase 8A: ジョブ作成後、バックグラウンドで Python パイプラインを実行する。
 * レスポンスは即座に返し、フロントエンドは polling で進捗を確認する。
 *
 * ── 責務の境界 ──
 * [Route Handler に残る] リクエスト検証・ジョブ作成・メタデータ保存・レスポンス返却
 * [バックグラウンド]     executePipelineForJob() が Python を呼び出し、結果を保存
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

  // Determine if this job should fail (file name contains "fail")
  const shouldFail = fileIds.some((id) => {
    const meta = getFile(id);
    return meta ? meta.originalName.toLowerCase().includes("fail") : false;
  });

  // Phase 8A: files 配列から floorLabels マッピングを構築
  const floorLabels: Record<string, string> | undefined = files
    ? Object.fromEntries(files.map((f) => [f.fileId, f.floorLabel]))
    : undefined;

  const jobId = `job-${Date.now()}`;
  const now = new Date().toISOString();

  storeJob({
    jobId,
    fileIds,
    shouldFail,
    scale: settings.scale,
    floorHeight: settings.floorHeight,
    createdAt: now,
    startedAtMs: Date.now(),
    floorLabels,
  });

  // Phase 8A: バックグラウンドでパイプラインを実行（fire-and-forget）
  // アップロードされた PDF ファイルが存在する場合のみ実行する
  const hasUploadedFiles = fileIds.every((id) => {
    const meta = getFile(id);
    return meta?.filePath;
  });

  if (hasUploadedFiles && !shouldFail) {
    executePipelineForJob(jobId).catch((err) => {
      console.error(`[POST /api/jobs] Pipeline execution failed for ${jobId}:`, err);
    });
  }

  return Response.json({
    jobId,
    status: "processing",
    fileIds,
    createdAt: now,
  });
}
