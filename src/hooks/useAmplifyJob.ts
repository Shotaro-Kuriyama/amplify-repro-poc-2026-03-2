"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AmplifyJob, ConversionSettings, JobArtifact, JobStatus } from "@/types";
import type { ApiJobStatus, ApiProcessingStep, GetJobResponse } from "@/lib/api/types";
import { api } from "@/lib/api/client";
import { normalizeError } from "@/lib/api/errors";
import { PROCESSING_STEPS } from "@/lib/constants";

// ── API → UI mapping ──

/** Map backend job status to UI job status */
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

/** Map a GetJobResponse to UI-facing AmplifyJob + artifacts */
function mapGetJobResponse(res: GetJobResponse): {
  job: AmplifyJob;
  artifacts: JobArtifact[];
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
    },
    artifacts: res.artifacts ?? [],
  };
}

// ── Hook ──

interface UseAmplifyJobReturn {
  status: JobStatus;
  job: AmplifyJob | null;
  artifacts: JobArtifact[];
  error: string | null;
  startConversion: (fileIds: string[], settings: ConversionSettings) => Promise<void>;
  reset: () => void;
}

export function useAmplifyJob(): UseAmplifyJobReturn {
  const [status, setStatus] = useState<JobStatus>("idle");
  const [job, setJob] = useState<AmplifyJob | null>(null);
  const [artifacts, setArtifacts] = useState<JobArtifact[]>([]);
  const [error, setError] = useState<string | null>(null);

  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollFnRef = useRef<((jobId: string, stepIndex: number) => void) | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  // Keep the polling function in a ref to avoid the circular dependency
  useEffect(() => {
    pollFnRef.current = async (jobId: string, stepIndex: number) => {
      try {
        const res = await api.getAmplifyJob(jobId);
        const mapped = mapGetJobResponse(res);
        setJob(mapped.job);

        if (res.status === "completed") {
          setStatus("completed");
          setArtifacts(mapped.artifacts);
          return;
        }

        if (res.status === "failed") {
          setStatus("failed");
          setError(res.error?.message ?? "変換中にエラーが発生しました");
          return;
        }

        const nextStep = Math.min(stepIndex + 1, PROCESSING_STEPS.length - 1);
        const delay = PROCESSING_STEPS[stepIndex]?.duration ?? 2000;

        pollingRef.current = setTimeout(() => {
          pollFnRef.current?.(jobId, nextStep);
        }, delay);
      } catch (err) {
        const apiErr = normalizeError(err);
        setStatus("failed");
        setError(apiErr.message);
      }
    };
  }, []);

  const startConversion = useCallback(
    async (fileIds: string[], settings: ConversionSettings) => {
      stopPolling();
      setStatus("processing");
      setError(null);
      setArtifacts([]);

      try {
        // Only send conversion-relevant settings to the API
        // (opacity and cameraMode are UI-only concerns)
        const res = await api.createAmplifyJob({
          fileIds,
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
        const delay = PROCESSING_STEPS[0]?.duration ?? 2000;
        pollingRef.current = setTimeout(() => {
          pollFnRef.current?.(res.jobId, 0);
        }, delay);
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
  }, [stopPolling]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  return { status, job, artifacts, error, startConversion, reset };
}
