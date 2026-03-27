import type { QuantityRow } from "@/types";
import type {
  AmplifyAPI,
  ApiJobStatus,
  ApiProcessingStep,
  CreateJobRequest,
  CreateJobResponse,
  DownloadArtifactRequest,
  DownloadQuantitiesRequest,
  DownloadQuantitiesResponse,
  GetJobResponse,
  SubmitLeadFormRequest,
  SubmitLeadFormResponse,
  UploadPlansRequest,
  UploadPlansResponse,
} from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Processing step progression ──

const STEP_PROGRESSION: Array<{
  progress: number;
  step: ApiProcessingStep;
}> = [
  { progress: 25, step: "analyzing_plans" },
  { progress: 50, step: "detecting_walls_and_openings" },
  { progress: 80, step: "building_3d_model" },
  { progress: 100, step: "preparing_artifacts" },
];

// ── Per-job state (isolated per job, no cross-job leakage) ──

interface MockJobState {
  progress: number;
  stepIndex: number;
  shouldFail: boolean;
  fileIds: string[];
  createdAt: string;
}

const jobStates = new Map<string, MockJobState>();

// Store file metadata by fileId for fail-check at job creation time
const fileMetaByFileId = new Map<
  string,
  { originalName: string; size: number; mimeType: string; uploadedAt: string }
>();

function getJobState(jobId: string): MockJobState | undefined {
  return jobStates.get(jobId);
}

function advanceJob(jobId: string): boolean {
  const state = jobStates.get(jobId);
  if (!state || state.stepIndex >= STEP_PROGRESSION.length) return false;
  const s = STEP_PROGRESSION[state.stepIndex];
  state.progress = s.progress;
  state.stepIndex++;
  return state.stepIndex < STEP_PROGRESSION.length;
}

// ── Mock data ──

const MOCK_QUANTITIES: QuantityRow[] = [
  { element: "壁", count: 24, unit: "本", totalLength: 87.5 },
  { element: "ドア", count: 8, unit: "枚", totalArea: 14.4 },
  { element: "窓", count: 12, unit: "枚", totalArea: 21.6 },
  { element: "部屋", count: 6, unit: "室", totalArea: 98.2 },
  { element: "シンク", count: 2, unit: "台" },
  { element: "浴槽", count: 1, unit: "台" },
  { element: "トイレ", count: 2, unit: "台" },
  { element: "シャワー", count: 1, unit: "台" },
];

// ── Mock API implementation ──

export const mockApi: AmplifyAPI = {
  async uploadPlans(req: UploadPlansRequest): Promise<UploadPlansResponse> {
    await sleep(800);
    const now = new Date().toISOString();
    const files = req.files.map((f, i) => {
      const fileId = `file-${Date.now()}-${i}`;
      const meta = {
        originalName: f.name,
        size: f.size,
        mimeType: f.type || "application/pdf",
        uploadedAt: now,
      };
      fileMetaByFileId.set(fileId, meta);
      return { fileId, ...meta };
    });
    return { files };
  },

  async createAmplifyJob(req: CreateJobRequest): Promise<CreateJobResponse> {
    await sleep(500);
    const jobId = `job-${Date.now()}`;
    const now = new Date().toISOString();

    // Determine fail status from the actual fileIds at conversion time
    const shouldFail = req.fileIds.some((id) => {
      const meta = fileMetaByFileId.get(id);
      return meta ? meta.originalName.toLowerCase().includes("fail") : false;
    });

    // Phase 8A: req.files は mock モードでは無視する（パイプライン未実行のため）
    const state: MockJobState = {
      progress: 0,
      stepIndex: 0,
      shouldFail,
      fileIds: req.fileIds,
      createdAt: now,
    };
    jobStates.set(jobId, state);

    return {
      jobId,
      status: "queued" as ApiJobStatus,
      fileIds: req.fileIds,
      createdAt: now,
    };
  },

  async getAmplifyJob(jobId: string): Promise<GetJobResponse> {
    await sleep(300);
    const hasMore = advanceJob(jobId);
    const state = getJobState(jobId);

    // Job not found — return failed with error
    if (!state) {
      return {
        jobId,
        status: "failed",
        progress: 0,
        currentStep: null,
        artifacts: null,
        quantitiesReady: false,
        error: {
          code: "JOB_NOT_FOUND",
          message: "指定されたジョブが見つかりません",
        },
        createdAt: new Date().toISOString(),
        completedAt: null,
      };
    }

    const currentStepIndex = Math.max(0, state.stepIndex - 1);
    const currentStep: ApiProcessingStep =
      STEP_PROGRESSION[Math.min(currentStepIndex, STEP_PROGRESSION.length - 1)]
        .step;

    // Simulate failure at step 2 when a "fail" file was uploaded for this job
    if (state.shouldFail && state.stepIndex >= 2) {
      jobStates.delete(jobId);
      return {
        jobId,
        status: "failed",
        progress: state.progress,
        currentStep,
        artifacts: null,
        quantitiesReady: false,
        error: {
          code: "PROCESSING_FAILED",
          message:
            "壁の検出に失敗しました。図面の品質を確認してください。（デモ用エラー：ファイル名に「fail」が含まれています）",
        },
        createdAt: state.createdAt,
        completedAt: null,
      };
    }

    // Completed
    if (!hasMore && state.progress >= 100) {
      const completedAt = new Date().toISOString();
      jobStates.delete(jobId);
      return {
        jobId,
        status: "completed",
        progress: 100,
        currentStep: "preparing_artifacts",
        artifacts: [
          { id: "a1", format: "ifc", fileName: "model.ifc", size: 2_400_000 },
          { id: "a2", format: "rvt", fileName: "model.rvt", size: 5_100_000 },
          { id: "a3", format: "dwg", fileName: "model.dwg", size: 1_800_000 },
        ],
        quantitiesReady: true,
        error: null,
        createdAt: state.createdAt,
        completedAt,
      };
    }

    // Still processing
    return {
      jobId,
      status: "processing",
      progress: state.progress,
      currentStep,
      artifacts: null,
      quantitiesReady: false,
      error: null,
      createdAt: state.createdAt,
      completedAt: null,
    };
  },

  async downloadArtifact(req: DownloadArtifactRequest): Promise<Blob> {
    await sleep(600);
    void req;
    return new Blob(["mock-artifact-data"], {
      type: "application/octet-stream",
    });
  },

  async downloadQuantities(
    req: DownloadQuantitiesRequest
  ): Promise<DownloadQuantitiesResponse> {
    await sleep(400);
    void req;
    return { rows: MOCK_QUANTITIES };
  },

  async submitLeadForm(
    req: SubmitLeadFormRequest
  ): Promise<SubmitLeadFormResponse> {
    await sleep(600);
    void req;
    return {
      submissionId: `lead-${Date.now()}`,
      submittedAt: new Date().toISOString(),
    };
  },
};
