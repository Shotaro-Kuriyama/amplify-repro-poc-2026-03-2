import type { QuantityRow } from "@/types";
import type {
  AmplifyAPI,
  CreateJobRequest,
  CreateJobResponse,
  DownloadArtifactRequest,
  DownloadQuantitiesRequest,
  DownloadQuantitiesResponse,
  GetJobResponse,
  SubmitLeadFormRequest,
  UploadPlansRequest,
  UploadPlansResponse,
} from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MOCK_STEPS = [
  { progress: 25, step: 0 },
  { progress: 50, step: 1 },
  { progress: 80, step: 2 },
  { progress: 100, step: 3 },
];

const STEP_MESSAGES = [
  "図面を解析しています…",
  "壁・開口部を検出しています…",
  "3Dモデルを生成しています…",
  "ダウンロードデータを準備しています…",
];

// ── Per-job state (isolated per job, no cross-job leakage) ──
interface MockJobState {
  progress: number;
  step: number;
  shouldFail: boolean;
}

const jobStates = new Map<string, MockJobState>();

// Store file names by fileId so we can check at job creation time
const fileNamesByFileId = new Map<string, string>();

function getJobState(jobId: string): MockJobState {
  let state = jobStates.get(jobId);
  if (!state) {
    state = { progress: 0, step: 0, shouldFail: false };
    jobStates.set(jobId, state);
  }
  return state;
}

function advanceJob(jobId: string): boolean {
  const state = getJobState(jobId);
  if (state.step >= MOCK_STEPS.length) return false;
  const s = MOCK_STEPS[state.step];
  state.progress = s.progress;
  state.step++;
  return state.step < MOCK_STEPS.length;
}

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

export const mockApi: AmplifyAPI = {
  async uploadPlans(req: UploadPlansRequest): Promise<UploadPlansResponse> {
    await sleep(800);
    const fileIds = req.files.map(
      (_, i) => `file-${Date.now()}-${i}`
    );
    // Store file names so we can check at job creation time (not upload time)
    req.files.forEach((f, i) => {
      fileNamesByFileId.set(fileIds[i], f.name);
    });
    return { fileIds };
  },

  async createAmplifyJob(req: CreateJobRequest): Promise<CreateJobResponse> {
    await sleep(500);
    const jobId = `job-${Date.now()}`;

    // Determine fail status from the actual fileIds at conversion time
    // This ensures removing a "fail" file before conversion prevents failure
    const shouldFail = req.fileIds.some((id) => {
      const name = fileNamesByFileId.get(id);
      return name ? name.toLowerCase().includes("fail") : false;
    });

    const state: MockJobState = {
      progress: 0,
      step: 0,
      shouldFail,
    };
    jobStates.set(jobId, state);

    return {
      job: {
        id: jobId,
        status: "processing",
        progress: 0,
        progressStep: 0,
        progressMessage: STEP_MESSAGES[0],
        createdAt: new Date().toISOString(),
      },
    };
  },

  async getAmplifyJob(jobId: string): Promise<GetJobResponse> {
    await sleep(300);
    const hasMore = advanceJob(jobId);
    const state = getJobState(jobId);

    // Simulate failure at step 2 when a "fail" file was uploaded for this job
    if (state.shouldFail && state.step >= 2) {
      // Clean up job state
      jobStates.delete(jobId);
      return {
        job: {
          id: jobId,
          status: "failed",
          progress: state.progress,
          progressStep: Math.max(0, state.step - 1),
          progressMessage: STEP_MESSAGES[Math.min(state.step - 1, STEP_MESSAGES.length - 1)] ?? STEP_MESSAGES[0],
          createdAt: new Date().toISOString(),
          error: "壁の検出に失敗しました。図面の品質を確認してください。（デモ用エラー：ファイル名に「fail」が含まれています）",
        },
      };
    }

    if (!hasMore && state.progress >= 100) {
      // Clean up job state
      jobStates.delete(jobId);
      return {
        job: {
          id: jobId,
          status: "completed",
          progress: 100,
          progressStep: MOCK_STEPS.length - 1,
          progressMessage: STEP_MESSAGES[STEP_MESSAGES.length - 1],
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        },
        artifacts: [
          { id: "a1", format: "ifc", fileName: "model.ifc", size: 2_400_000 },
          { id: "a2", format: "rvt", fileName: "model.rvt", size: 5_100_000 },
          { id: "a3", format: "dwg", fileName: "model.dwg", size: 1_800_000 },
        ],
      };
    }

    return {
      job: {
        id: jobId,
        status: "processing",
        progress: state.progress,
        progressStep: Math.max(0, state.step - 1),
        progressMessage:
          STEP_MESSAGES[Math.min(state.step - 1, STEP_MESSAGES.length - 1)] ??
          STEP_MESSAGES[0],
        createdAt: new Date().toISOString(),
      },
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

  async submitLeadForm(req: SubmitLeadFormRequest): Promise<void> {
    await sleep(600);
    void req;
  },
};
