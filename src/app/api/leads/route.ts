import { NextRequest } from "next/server";
import { z } from "zod";
import { storeLead } from "@/lib/server/store";
import { errorResponse } from "@/lib/server/helpers";

const leadFormSchema = z.object({
  data: z.object({
    name: z.string().min(1),
    email: z.string().email(),
    country: z.string().min(1),
    organizationType: z.string().min(1),
    company: z.string().min(1),
  }),
  jobId: z.string().min(1),
});

/**
 * POST /api/leads
 *
 * Submit a lead form before downloading artifacts.
 *
 * ── 責務の境界 ──
 * [Route Handler に残る] リクエスト検証・リード保存・レスポンス返却
 * [将来 Worker へ移す]  なし（リード管理は Route Handler / API Server の責務）
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "VALIDATION_ERROR", "リクエストボディが不正です");
  }

  const parsed = leadFormSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(400, "VALIDATION_ERROR", "入力が不正です", {
      issues: parsed.error.issues,
    });
  }

  const { data, jobId } = parsed.data;
  const submissionId = `lead-${Date.now()}`;
  const submittedAt = new Date().toISOString();

  storeLead({ submissionId, data, jobId, submittedAt });

  return Response.json({ submissionId, submittedAt });
}
