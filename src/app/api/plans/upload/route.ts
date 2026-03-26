import { NextRequest } from "next/server";
import { storeFile } from "@/lib/server/store";
import { fileStorage } from "@/lib/server/file-storage";
import { errorResponse } from "@/lib/server/helpers";

/**
 * POST /api/plans/upload
 *
 * Accepts multipart/form-data with one or more PDF files.
 * Returns file metadata with server-assigned IDs.
 *
 * Phase 7.5: ファイル実体をローカルディスクに保存する。
 * メタデータは引き続き in-memory store に保持。
 *
 * ── 責務の境界 ──
 * [Route Handler に残る] リクエスト受付・バリデーション・メタデータ管理
 * [将来 Worker へ移す]  なし（upload は Route Handler の責務）
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const entries = formData.getAll("files");

    if (entries.length === 0) {
      return errorResponse(400, "VALIDATION_ERROR", "ファイルが送信されていません");
    }

    const now = new Date().toISOString();
    const files = await Promise.all(
      entries.map(async (entry, i) => {
        const file = entry as File;
        const fileId = `file-${Date.now()}-${i}`;

        // Phase 7.5: ファイル実体をストレージに保存
        const buffer = Buffer.from(await file.arrayBuffer());
        const filePath = await fileStorage.save(fileId, buffer, file.name);

        const meta = {
          fileId,
          originalName: file.name,
          size: file.size,
          mimeType: file.type || "application/pdf",
          uploadedAt: now,
          filePath, // Phase 7.5: ストレージ上のパスを保持
        };
        storeFile(meta);
        return {
          fileId: meta.fileId,
          originalName: meta.originalName,
          size: meta.size,
          mimeType: meta.mimeType,
          uploadedAt: meta.uploadedAt,
        };
      })
    );

    return Response.json({ files });
  } catch {
    return errorResponse(500, "UPLOAD_FAILED", "アップロード処理に失敗しました");
  }
}
