"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AmplifyJob, ConversionSettings, JobArtifact, JobStatus, PipelineResultSummary } from "@/types";
import type { ApiJobStatus, ApiProcessingStep, GetJobResponse } from "@/lib/api/types";
import { api } from "@/lib/api/client";
import { normalizeError } from "@/lib/api/errors";

// ── Polling config ──

/** How often to poll getAmplifyJob while processing (ms) */
const POLL_INTERVAL = 1500;

// ── API → UI mapping ──

/**
 * Map backend job status to UI job status.
 * `queued` is treated as `processing` in the UI — the user sees
 * a single "converting" state regardless of backend queue handling.
 */
function mapApiStatus(apiStatus: ApiJobStatus): JobStatus {
  if (apiStatus === "queued") return "processing";
  return apiStatus; // processing, completed, failed map directly
}

/** Map API processing step to step index (0-based) */
const STEP_INDEX_MAP: Record<ApiProcessingStep, number> = {
  analyzing_plans: 0,
  detecting_walls_and_openings: 1,
  building_3d_model: 2,
  preparing_artifacts: 3,
};

/**
 * Phase 8A: API の pipelineResult (Record<string, unknown>) を
 * UI 用の PipelineResultSummary に変換する。
 */
function parsePipelineResult(raw: Record<string, unknown>): PipelineResultSummary | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = raw as any;
    return {
      success: !!data.success,
      floors: (Array.isArray(data.floors) ? data.floors : []).map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (f: any) => ({
          floorLabel: f.floorLabel ?? "",
          wallCount: Array.isArray(f.walls) ? f.walls.length : 0,
          openingCount: Array.isArray(f.openings) ? f.openings.length : 0,
          roomCount: Array.isArray(f.rooms) ? f.rooms.length : 0,
          pageWidth: f.source?.pageWidth ?? 0,
          pageHeight: f.source?.pageHeight ?? 0,
        })
      ),
      stats: {
        totalWalls: data.stats?.totalWalls ?? 0,
        totalOpenings: data.stats?.totalOpenings ?? 0,
        totalRooms: data.stats?.totalRooms ?? 0,
        durationMs: data.stats?.durationMs ?? 0,
      },
    };
  } catch {
    return null;
  }
}

/** Map a GetJobResponse to UI-facing AmplifyJob + artifacts + pipelineResult */
function mapGetJobResponse(res: GetJobResponse): {
  job: AmplifyJob;
  artifacts: JobArtifact[];
  pipelineResult: PipelineResultSummary | null;
} {
  const stepIndex = res.currentStep
    ? STEP_INDEX_MAP[res.currentStep]
    : 0;

  return {
    job: {
      id: res.jobId,
      status: mapApiStatus(res.status),
      progress: res.progress,
      progressStep: stepIndex,
      progressMessage: "", // UI derives from stepIndex + i18n
      createdAt: res.createdAt,
      completedAt: res.completedAt ?? undefined,
      error: res.error?.message,
      errorCode: res.error?.code,
    },
    artifacts: res.artifacts ?? [],
    pipelineResult: res.pipelineResult
      ? parsePipelineResult(res.pipelineResult)
      : null,
  };
}

// ── Hook ──

/** Phase 8A: fileId と floorLabel の対応 */
interface FileEntry {
  fileId: string;
  floorLabel: string;
}

interface UseAmplifyJobReturn {
  status: JobStatus;
  job: AmplifyJob | null;
  artifacts: JobArtifact[];
  error: string | null;
  /** Phase 8A: エラーコード（failed 時） */
  errorCode: string | null;
  /** Phase 8A: パイプライン結果サマリー（completed 時） */
  pipelineResult: PipelineResultSummary | null;
  /** Phase 8A: files に fileId + floorLabel の対応を渡す */
  startConversion: (files: FileEntry[], settings: ConversionSettings) => Promise<void>;
  reset: () => void;
}

export function useAmplifyJob(): UseAmplifyJobReturn {
  const [status, setStatus] = useState<JobStatus>("idle");
  const [job, setJob] = useState<AmplifyJob | null>(null);
  const [artifacts, setArtifacts] = useState<JobArtifact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [pipelineResult, setPipelineResult] = useState<PipelineResultSummary | null>(null);

  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollFnRef = useRef<((jobId: string) => void) | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  // Keep the polling function in a ref to avoid circular dependency
  useEffect(() => {
    pollFnRef.current = async (jobId: string) => {
      try {
        const res = await api.getAmplifyJob(jobId);
        const mapped = mapGetJobResponse(res);
        setJob(mapped.job);

        if (res.status === "completed") {
          setStatus("completed");
          setArtifacts(mapped.artifacts);
          setPipelineResult(mapped.pipelineResult);
          return;
        }

        if (res.status === "failed") {
          setStatus("failed");
          setError(res.error?.message ?? "変換中にエラーが発生しました");
          setErrorCode(res.error?.code ?? null);
          return;
        }

        // Continue polling at fixed interval
        pollingRef.current = setTimeout(() => {
          pollFnRef.current?.(jobId);
        }, POLL_INTERVAL);
      } catch (err) {
        const apiErr = normalizeError(err);
        setStatus("failed");
        setError(apiErr.message);
      }
    };
  }, []);

  const startConversion = useCallback(
    async (files: FileEntry[], settings: ConversionSettings) => {
      stopPolling();
      setStatus("processing");
      setError(null);
      setErrorCode(null);
      setArtifacts([]);
      setPipelineResult(null);

      try {
        // Phase 8A: fileId と floorLabel の対応を API に渡す
        const fileIds = files.map((f) => f.fileId);
        const res = await api.createAmplifyJob({
          fileIds,
          files,
          settings: {
            scale: settings.scale,
            floorHeight: settings.floorHeight,
          },
        });

        // Map createJob response to initial UI job state
        const initialJob: AmplifyJob = {
          id: res.jobId,
          status: mapApiStatus(res.status),
          progress: 0,
          progressStep: 0,
          progressMessage: "",
          createdAt: res.createdAt,
        };
        setJob(initialJob);

        // Start polling for progress
        pollingRef.current = setTimeout(() => {
          pollFnRef.current?.(res.jobId);
        }, POLL_INTERVAL);
      } catch (err) {
        const apiErr = normalizeError(err);
        setStatus("failed");
        setError(apiErr.message);
      }
    },
    [stopPolling]
  );

  const reset = useCallback(() => {
    stopPolling();
    setStatus("idle");
    setJob(null);
    setArtifacts([]);
    setError(null);
    setErrorCode(null);
    setPipelineResult(null);
  }, [stopPolling]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  return { status, job, artifacts, error, errorCode, pipelineResult, startConversion, reset };
}
