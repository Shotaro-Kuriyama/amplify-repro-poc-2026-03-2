import { NextRequest } from "next/server";
import { z } from "zod";
import { buildPipelineInput, runPipeline } from "@/lib/server/pipeline";
import { errorResponse } from "@/lib/server/helpers";

const runPipelineSchema = z.object({
  jobId: z.string().min(1),
});

/**
 * POST /api/internal/pipeline/run
 *
 * Phase 8A 実験用エンドポイント。
 * 既存の 6 API 契約には含まれない内部用 API。
 *
 * 処理の流れ:
 * 1. jobId を受け取る
 * 2. StoredJob + StoredFile から PipelineInput を組み立てる
 * 3. Python スクリプト (extract_pdf.py) を子プロセスとして呼び出す
 * 4. PipelineOutput JSON を返す
 *
 * 前提:
 * - 事前に uploadPlans → createAmplifyJob でジョブを作成済みであること
 * - Python 3 + PyMuPDF がインストール済みであること
 *
 * ── 責務の境界 ──
 * [Route Handler に残る] リクエスト検証・PipelineInput 組み立て・レスポンス返却
 * [Python に委譲]        PDF 読み取り・構造化データ抽出
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "VALIDATION_ERROR", "リクエストボディが不正です");
  }

  const parsed = runPipelineSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(400, "VALIDATION_ERROR", "jobId が必要です");
  }

  const { jobId } = parsed.data;

  // PipelineInput を組み立てる
  let input;
  try {
    input = buildPipelineInput(jobId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "PipelineInput の組み立てに失敗しました";
    return errorResponse(400, "PIPELINE_INPUT_ERROR", message);
  }

  // Python 処理を呼び出す
  try {
    const output = await runPipeline(input);
    return Response.json(output);
  } catch (err) {
    const message = err instanceof Error ? err.message : "パイプライン処理に失敗しました";
    return errorResponse(500, "PIPELINE_EXECUTION_ERROR", message);
  }
}
