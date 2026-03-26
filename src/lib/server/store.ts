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
  shouldFail: boolean;
  scale: number;
  floorHeight: number;
  createdAt: string;
  startedAtMs: number; // Date.now() when created — used for time-based progression
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
// Job progression logic — 時間ベースの進捗計算
// ═══════════════════════════════════════════════════════════

/** Step progression: each entry defines elapsed-time threshold and target progress */
const STEP_TIMELINE: Array<{
  startAt: number; // ms from job creation
  endAt: number;
  step: ApiProcessingStep;
  progressStart: number;
  progressEnd: number;
}> = [
  { startAt: 0, endAt: 2000, step: "analyzing_plans", progressStart: 0, progressEnd: 25 },
  { startAt: 2000, endAt: 5000, step: "detecting_walls_and_openings", progressStart: 25, progressEnd: 50 },
  { startAt: 5000, endAt: 8500, step: "building_3d_model", progressStart: 50, progressEnd: 80 },
  { startAt: 8500, endAt: 10000, step: "preparing_artifacts", progressStart: 80, progressEnd: 100 },
];

const TOTAL_DURATION = 10000; // ms
const FAIL_AT_MS = 5000; // fail at the start of step 3

/** Compute current job status/progress based on elapsed time */
export function computeJobState(job: StoredJob): {
  status: ApiJobStatus;
  progress: number;
  currentStep: ApiProcessingStep | null;
  completedAt: string | null;
  error: { code: string; message: string } | null;
} {
  const elapsed = Date.now() - job.startedAtMs;

  // Fail check: if shouldFail and enough time has passed
  if (job.shouldFail && elapsed >= FAIL_AT_MS) {
    return {
      status: "failed",
      progress: 50,
      currentStep: "detecting_walls_and_openings",
      completedAt: null,
      error: {
        code: "PROCESSING_FAILED",
        message:
          "壁の検出に失敗しました。図面の品質を確認してください。（デモ用エラー：ファイル名に「fail」が含まれています）",
      },
    };
  }

  // Completed
  if (elapsed >= TOTAL_DURATION) {
    return {
      status: "completed",
      progress: 100,
      currentStep: "preparing_artifacts",
      completedAt: new Date(job.startedAtMs + TOTAL_DURATION).toISOString(),
      error: null,
    };
  }

  // Find current step based on elapsed time
  for (const step of STEP_TIMELINE) {
    if (elapsed >= step.startAt && elapsed < step.endAt) {
      const stepElapsed = elapsed - step.startAt;
      const stepDuration = step.endAt - step.startAt;
      const ratio = stepElapsed / stepDuration;
      const progress = Math.round(
        step.progressStart + ratio * (step.progressEnd - step.progressStart)
      );
      return {
        status: "processing",
        progress,
        currentStep: step.step,
        completedAt: null,
        error: null,
      };
    }
  }

  // Fallback — should not reach here
  return {
    status: "queued",
    progress: 0,
    currentStep: null,
    completedAt: null,
    error: null,
  };
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
