import { promises as fs } from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { getJob, computeJobState } from "@/lib/server/store";
import { errorResponse } from "@/lib/server/helpers";

const VALID_FORMATS = ["ifc", "rvt", "dwg", "structured_json"];

/**
 * GET /api/jobs/:jobId/artifacts/:format
 *
 * Download a generated artifact file.
 *
 * Phase 8A: structured_json と ifc フォーマットの場合、
 * パイプラインが生成した実データを返す。
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string; format: string }> }
) {
  const { jobId, format } = await params;

  if (!VALID_FORMATS.includes(format)) {
    return errorResponse(400, "VALIDATION_ERROR", `不正なフォーマット: ${format}`);
  }

  const job = getJob(jobId);
  if (!job) {
    return errorResponse(404, "JOB_NOT_FOUND", "指定されたジョブが見つかりません");
  }

  const state = computeJobState(job);
  if (state.status !== "completed") {
    return errorResponse(409, "DOWNLOAD_NOT_READY", "ジョブがまだ完了していません");
  }

  if (format === "structured_json" && job.pipelineOutput) {
    const content = JSON.stringify(job.pipelineOutput, null, 2);
    return new Response(content, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="structured.json"',
      },
    });
  }

  if (format === "ifc" && job.pipelineOutput) {
    const ifcArtifact = job.pipelineOutput.artifacts.find((artifact) => artifact.format === "ifc");
    if (!ifcArtifact) {
      return errorResponse(404, "ARTIFACT_NOT_FOUND", "IFC 成果物が見つかりません");
    }
    if (ifcArtifact.filePath === "(inline)") {
      return errorResponse(500, "ARTIFACT_INVALID", "IFC 成果物の保存先が不正です");
    }

    try {
      const buffer = await fs.readFile(ifcArtifact.filePath);
      const fileName = path.basename(ifcArtifact.filePath);
      return new Response(buffer, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${fileName}"`,
        },
      });
    } catch {
      return errorResponse(500, "ARTIFACT_READ_ERROR", "IFC 成果物の読み込みに失敗しました");
    }
  }

  const content = `mock-artifact-data-${format}`;
  return new Response(content, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="model.${format}"`,
    },
  });
}
