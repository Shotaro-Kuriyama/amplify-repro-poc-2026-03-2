/**
 * Phase 8A: PipelineInput の組み立てと Python 処理の呼び出し。
 *
 * StoredJob + StoredFile から PipelineInput を構築し、
 * Python スクリプトを子プロセスとして呼び出す。
 */

import { execFile } from "child_process";
import path from "path";
import { getJob, getFile } from "./store";
import type { PipelineInput, PipelineOutput } from "@/types/pipeline";

// ── PipelineInput の組み立て ──

/**
 * floorLabel のフォールバック生成ルール。
 * StoredJob.floorLabels が未設定の場合にのみ使用する。
 * ファイルの並び順に 1F, 2F, 3F... と自動採番する。
 */
function fallbackFloorLabel(index: number): string {
  return `${index + 1}F`;
}

/**
 * StoredJob から PipelineInput を組み立てる。
 *
 * Phase 8A: フロントエンドから渡された floorLabel があればそれを使い、
 * なければ自動採番にフォールバックする。
 *
 * エラー時は理由を含む Error を throw する。
 */
export function buildPipelineInput(jobId: string): PipelineInput {
  const job = getJob(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const files = job.fileIds.map((fileId, i) => {
    const file = getFile(fileId);
    if (!file) {
      throw new Error(`File not found: ${fileId}`);
    }
    if (!file.filePath) {
      throw new Error(`File has no storage path: ${fileId} (upload may have failed)`);
    }
    // フロントエンドから渡された floorLabel を優先し、なければ自動採番
    const floorLabel = job.floorLabels?.[fileId] ?? fallbackFloorLabel(i);
    return {
      fileId: file.fileId,
      filePath: file.filePath,
      originalName: file.originalName,
      floorLabel,
    };
  });

  return {
    jobId: job.jobId,
    files,
    settings: {
      scale: job.scale,
      floorHeight: job.floorHeight,
    },
  };
}

// ── Python 処理の呼び出し ──

const PYTHON_SCRIPT = path.join(process.cwd(), "scripts", "pipeline", "extract_pdf.py");

/**
 * Python スクリプトを子プロセスとして呼び出し、PipelineOutput を返す。
 *
 * プロトコル:
 * - stdin に PipelineInput JSON を渡す
 * - stdout から PipelineOutput JSON を受け取る
 * - stderr はエラーログとして扱う
 */
export function runPipeline(input: PipelineInput): Promise<PipelineOutput> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "python3",
      [PYTHON_SCRIPT],
      { maxBuffer: 10 * 1024 * 1024, timeout: 60000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Python process failed: ${error.message}\nstderr: ${stderr}`));
          return;
        }

        try {
          const output = JSON.parse(stdout) as PipelineOutput;
          resolve(output);
        } catch (parseError) {
          reject(
            new Error(
              `Failed to parse Python output as JSON: ${parseError}\nstdout: ${stdout.slice(0, 500)}`
            )
          );
        }
      }
    );

    // stdin に PipelineInput を渡して閉じる
    child.stdin?.write(JSON.stringify(input));
    child.stdin?.end();
  });
}
