import { NextRequest } from "next/server";
import { storeFile } from "@/lib/server/store";
import { errorResponse } from "@/lib/server/helpers";

/**
 * POST /api/plans/upload
 *
 * Accepts multipart/form-data with one or more PDF files.
 * Returns file metadata with server-assigned IDs.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const entries = formData.getAll("files");

    if (entries.length === 0) {
      return errorResponse(400, "VALIDATION_ERROR", "ファイルが送信されていません");
    }

    const now = new Date().toISOString();
    const files = entries.map((entry, i) => {
      const file = entry as File;
      const fileId = `file-${Date.now()}-${i}`;
      const meta = {
        fileId,
        originalName: file.name,
        size: file.size,
        mimeType: file.type || "application/pdf",
        uploadedAt: now,
      };
      storeFile(meta);
      return meta;
    });

    return Response.json({ files });
  } catch {
    return errorResponse(500, "UPLOAD_FAILED", "アップロード処理に失敗しました");
  }
}
