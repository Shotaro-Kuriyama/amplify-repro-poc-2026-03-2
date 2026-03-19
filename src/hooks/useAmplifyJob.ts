"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AmplifyJob, ConversionSettings, JobArtifact, JobStatus } from "@/types";
import { api } from "@/lib/api/client";
import { PROCESSING_STEPS } from "@/lib/constants";

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
        setJob(res.job);

        if (res.job.status === "completed") {
          setStatus("completed");
          setArtifacts(res.artifacts ?? []);
          return;
        }

        if (res.job.status === "failed") {
          setStatus("failed");
          setError(res.job.error ?? "変換中にエラーが発生しました");
          return;
        }

        const nextStep = Math.min(stepIndex + 1, PROCESSING_STEPS.length - 1);
        const delay = PROCESSING_STEPS[stepIndex]?.duration ?? 2000;

        pollingRef.current = setTimeout(() => {
          pollFnRef.current?.(jobId, nextStep);
        }, delay);
      } catch (err) {
        setStatus("failed");
        setError(err instanceof Error ? err.message : "不明なエラーが発生しました");
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
        const { job: newJob } = await api.createAmplifyJob({
          fileIds,
          settings,
        });
        setJob(newJob);

        // Start polling for progress
        const delay = PROCESSING_STEPS[0]?.duration ?? 2000;
        pollingRef.current = setTimeout(() => {
          pollFnRef.current?.(newJob.id, 0);
        }, delay);
      } catch (err) {
        setStatus("failed");
        setError(err instanceof Error ? err.message : "ジョブの作成に失敗しました");
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
