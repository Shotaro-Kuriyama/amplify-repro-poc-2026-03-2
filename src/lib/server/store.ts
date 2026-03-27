/**
 * In-memory store for the pseudo backend (Route Handlers).
 *
 * Phase 7.5: リポジトリインターフェースを導入し、永続化の境界を明確にした。
 *
 * 現在の実装:
 * - FileRepository / JobRepository / LeadRepository のインターフェースを定義
 * - デフォルトは InMemory 実装（サーバー再起動でデータ消失）
 * - 将来は SQLite / PostgreSQL 等に差し替え可能
 *
 * 既存の関数（storeFile, getFile, storeJob, getJob 等）は
 * 後方互換のためそのまま export している。
 * Route Handler からの呼び出し方は変わらない。
 */

import type { ApiJobStatus, ApiProcessingStep } from "@/lib/api/types";
import type { PipelineOutput } from "@/types/pipeline";

// ═══════════════════════════════════════════════════════════
// Repository interfaces — 永続化の境界
// ═══════════════════════════════════════════════════════════

// ── File metadata ──

export interface StoredFile {
  fileId: string;
  originalName: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
  /** Phase 7.5: ストレージ上のファイルパス（未保存の場合 undefined） */
  filePath?: string;
}

/** ファイルメタデータの永続化インターフェース */
export interface FileRepository {
  save(file: StoredFile): void;
  findById(fileId: string): StoredFile | undefined;
}

// ── Job state ──

export interface StoredJob {
  jobId: string;
  fileIds: string[];
  scale: number;
  floorHeight: number;
  createdAt: string;
  /**
   * Phase 8A: fileId → floorLabel の対応。
   * フロントエンドから渡された階ラベル情報を保持する。
   * 未指定時は pipeline.ts 側で自動採番する。
   */
  floorLabels?: Record<string, string>;
  /**
   * パイプライン実行状態。
   * ジョブ作成時は "queued"、パイプライン実行開始で "processing"、
   * 実行完了で "completed" or "failed" になる。
   *
   * すべてのジョブは実際のパイプライン実行結果に基づいて状態遷移する。
   * 時間ベースの疑似進捗や shouldFail による mock 失敗は廃止された。
   */
  pipelineStatus: ApiJobStatus;
  /** パイプライン実行結果（成功時） */
  pipelineOutput?: PipelineOutput;
  /** パイプライン実行エラー（失敗時） */
  pipelineError?: { code: string; message: string };
  /** 完了日時（completed / failed 時に設定） */
  completedAt?: string;
}

/** ジョブ状態の永続化インターフェース */
export interface JobRepository {
  save(job: StoredJob): void;
  findById(jobId: string): StoredJob | undefined;
}

// ── Lead submissions ──

export interface StoredLead {
  submissionId: string;
  data: {
    name: string;
    email: string;
    country: string;
    organizationType: string;
    company: string;
  };
  jobId: string;
  submittedAt: string;
}

/** リード情報の永続化インターフェース */
export interface LeadRepository {
  save(lead: StoredLead): void;
}

// ═══════════════════════════════════════════════════════════
// In-memory implementations — 現在のデフォルト
// ═══════════════════════════════════════════════════════════

class InMemoryFileRepository implements FileRepository {
  private store = new Map<string, StoredFile>();

  save(file: StoredFile): void {
    this.store.set(file.fileId, file);
  }

  findById(fileId: string): StoredFile | undefined {
    return this.store.get(fileId);
  }
}

class InMemoryJobRepository implements JobRepository {
  private store = new Map<string, StoredJob>();

  save(job: StoredJob): void {
    this.store.set(job.jobId, job);
  }

  findById(jobId: string): StoredJob | undefined {
    return this.store.get(jobId);
  }
}

class InMemoryLeadRepository implements LeadRepository {
  private store = new Map<string, StoredLead>();

  save(lead: StoredLead): void {
    this.store.set(lead.submissionId, lead);
  }
}

// ═══════════════════════════════════════════════════════════
// Singleton instances
// 将来は環境変数や DI で実装を切り替える想定
// 例: if (process.env.DB_TYPE === "sqlite") { ... }
// ═══════════════════════════════════════════════════════════

const fileRepo: FileRepository = new InMemoryFileRepository();
const jobRepo: JobRepository = new InMemoryJobRepository();
const leadRepo: LeadRepository = new InMemoryLeadRepository();

// ═══════════════════════════════════════════════════════════
// 後方互換の関数 export
// Route Handler は引き続きこれらを使う。内部はリポジトリ経由。
// ═══════════════════════════════════════════════════════════

export function storeFile(file: StoredFile): void {
  fileRepo.save(file);
}

export function getFile(fileId: string): StoredFile | undefined {
  return fileRepo.findById(fileId);
}

export function storeJob(job: StoredJob): void {
  jobRepo.save(job);
}

export function getJob(jobId: string): StoredJob | undefined {
  return jobRepo.findById(jobId);
}

export function storeLead(lead: StoredLead): void {
  leadRepo.save(lead);
}

// ═══════════════════════════════════════════════════════════
// Job state — パイプライン実行結果に基づく状態返却
// ═══════════════════════════════════════════════════════════

/**
 * ジョブの現在の状態を返す。
 *
 * すべてのジョブは実際のパイプライン実行結果に基づいて状態遷移する。
 * - queued: パイプライン実行待ち
 * - processing: パイプライン実行中
 * - completed: パイプライン正常完了
 * - failed: パイプライン実行失敗（Python エラー / 入力不備 / パース失敗 等）
 *
 * 旧来の時間ベース疑似進捗や shouldFail による mock 失敗は廃止された。
 */
export function computeJobState(job: StoredJob): {
  status: ApiJobStatus;
  progress: number;
  currentStep: ApiProcessingStep | null;
  completedAt: string | null;
  error: { code: string; message: string } | null;
} {
  switch (job.pipelineStatus) {
    case "completed":
      return {
        status: "completed",
        progress: 100,
        currentStep: "preparing_artifacts",
        completedAt: job.completedAt ?? null,
        error: null,
      };

    case "failed":
      return {
        status: "failed",
        progress: 0,
        currentStep: null,
        completedAt: job.completedAt ?? null,
        error: job.pipelineError ?? { code: "UNKNOWN", message: "不明なエラー" },
      };

    case "processing":
      return {
        status: "processing",
        progress: 50,
        currentStep: "detecting_walls_and_openings",
        completedAt: null,
        error: null,
      };

    case "queued":
    default:
      return {
        status: "queued",
        progress: 0,
        currentStep: null,
        completedAt: null,
        error: null,
      };
  }
}

// ── Mock quantities data ──

export const MOCK_QUANTITIES = [
  { element: "壁", count: 24, unit: "本", totalLength: 87.5 },
  { element: "ドア", count: 8, unit: "枚", totalArea: 14.4 },
  { element: "窓", count: 12, unit: "枚", totalArea: 21.6 },
  { element: "部屋", count: 6, unit: "室", totalArea: 98.2 },
  { element: "シンク", count: 2, unit: "台" },
  { element: "浴槽", count: 1, unit: "台" },
  { element: "トイレ", count: 2, unit: "台" },
  { element: "シャワー", count: 1, unit: "台" },
];

// ── Mock artifact metadata ──

export const MOCK_ARTIFACTS = [
  { id: "a1", format: "ifc" as const, fileName: "model.ifc", size: 2_400_000 },
  { id: "a2", format: "rvt" as const, fileName: "model.rvt", size: 5_100_000 },
  { id: "a3", format: "dwg" as const, fileName: "model.dwg", size: 1_800_000 },
];
