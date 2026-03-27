"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AmplifyJob,
  ConversionSettings,
  JobArtifact,
  JobStatus,
  PipelineResultSummary,
  PipelineViewerFloor,
  PipelineViewerModel,
  PipelineViewerOpening,
  PipelineViewerWall,
} from "@/types";
import type { ApiJobStatus, ApiProcessingStep, GetJobResponse } from "@/lib/api/types";
import { api } from "@/lib/api/client";
import { normalizeError } from "@/lib/api/errors";

const POLL_INTERVAL = 1500;

function mapApiStatus(apiStatus: ApiJobStatus): JobStatus {
  if (apiStatus === "queued") return "processing";
  return apiStatus;
}

const STEP_INDEX_MAP: Record<ApiProcessingStep, number> = {
  analyzing_plans: 0,
  detecting_walls_and_openings: 1,
  building_3d_model: 2,
  preparing_artifacts: 3,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function parseWall(raw: unknown): PipelineViewerWall | null {
  if (!isRecord(raw)) return null;
  return {
    id: toString(raw.id, ""),
    startX: toNumber(raw.startX),
    startY: toNumber(raw.startY),
    endX: toNumber(raw.endX),
    endY: toNumber(raw.endY),
    thickness: Math.max(toNumber(raw.thickness), 0),
  };
}

function parseOpening(raw: unknown): PipelineViewerOpening | null {
  if (!isRecord(raw)) return null;
  const openingType = raw.type === "door" || raw.type === "window" || raw.type === "unknown"
    ? raw.type
    : "unknown";

  return {
    id: toString(raw.id, ""),
    type: openingType,
    centerX: toNumber(raw.centerX),
    centerY: toNumber(raw.centerY),
    width: Math.max(toNumber(raw.width), 0),
    height: Math.max(toNumber(raw.height), 0),
    wallId: raw.wallId ? toString(raw.wallId, "") : undefined,
  };
}

function parseFloor(raw: unknown): PipelineViewerFloor | null {
  if (!isRecord(raw)) return null;

  const walls = Array.isArray(raw.walls)
    ? raw.walls
      .map(parseWall)
      .filter((wall): wall is PipelineViewerWall => wall !== null)
    : [];

  const openings = Array.isArray(raw.openings)
    ? raw.openings
      .map(parseOpening)
      .filter((opening): opening is PipelineViewerOpening => opening !== null)
    : [];

  const source = isRecord(raw.source) ? raw.source : {};

  return {
    floorLabel: toString(raw.floorLabel, ""),
    pageWidth: toNumber(source.pageWidth),
    pageHeight: toNumber(source.pageHeight),
    roomCount: Array.isArray(raw.rooms) ? raw.rooms.length : 0,
    walls,
    openings,
  };
}

function parsePipelineModel(raw: Record<string, unknown>): PipelineViewerModel | null {
  try {
    const floors = Array.isArray(raw.floors)
      ? raw.floors
        .map(parseFloor)
        .filter((floor): floor is PipelineViewerFloor => floor !== null)
      : [];

    const stats = isRecord(raw.stats) ? raw.stats : {};

    return {
      success: !!raw.success,
      floors,
      stats: {
        totalWalls: toNumber(stats.totalWalls),
        totalOpenings: toNumber(stats.totalOpenings),
        totalRooms: toNumber(stats.totalRooms),
        durationMs: toNumber(stats.durationMs),
      },
    };
  } catch {
    return null;
  }
}

function toSummary(model: PipelineViewerModel): PipelineResultSummary {
  return {
    success: model.success,
    floors: model.floors.map((floor) => ({
      floorLabel: floor.floorLabel,
      wallCount: floor.walls.length,
      openingCount: floor.openings.length,
      roomCount: floor.roomCount,
      pageWidth: floor.pageWidth,
      pageHeight: floor.pageHeight,
    })),
    stats: model.stats,
  };
}

function mapGetJobResponse(res: GetJobResponse): {
  job: AmplifyJob;
  artifacts: JobArtifact[];
  pipelineResult: PipelineResultSummary | null;
  pipelineModel: PipelineViewerModel | null;
} {
  const stepIndex = res.currentStep ? STEP_INDEX_MAP[res.currentStep] : 0;

  const pipelineModel = res.pipelineResult
    ? parsePipelineModel(res.pipelineResult)
    : null;

  return {
    job: {
      id: res.jobId,
      status: mapApiStatus(res.status),
      progress: res.progress,
      progressStep: stepIndex,
      progressMessage: "",
      createdAt: res.createdAt,
      completedAt: res.completedAt ?? undefined,
      error: res.error?.message,
      errorCode: res.error?.code,
    },
    artifacts: res.artifacts ?? [],
    pipelineResult: pipelineModel ? toSummary(pipelineModel) : null,
    pipelineModel,
  };
}

interface FileEntry {
  fileId: string;
  floorLabel: string;
}

interface UseAmplifyJobReturn {
  status: JobStatus;
  job: AmplifyJob | null;
  artifacts: JobArtifact[];
  error: string | null;
  errorCode: string | null;
  pipelineResult: PipelineResultSummary | null;
  pipelineModel: PipelineViewerModel | null;
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
  const [pipelineModel, setPipelineModel] = useState<PipelineViewerModel | null>(null);

  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollFnRef = useRef<((jobId: string) => void) | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

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
          setPipelineModel(mapped.pipelineModel);
          return;
        }

        if (res.status === "failed") {
          setStatus("failed");
          setError(res.error?.message ?? "変換中にエラーが発生しました");
          setErrorCode(res.error?.code ?? null);
          return;
        }

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
      setPipelineModel(null);

      try {
        const fileIds = files.map((file) => file.fileId);
        const res = await api.createAmplifyJob({
          fileIds,
          files,
          settings: {
            scale: settings.scale,
            floorHeight: settings.floorHeight,
          },
        });

        const initialJob: AmplifyJob = {
          id: res.jobId,
          status: mapApiStatus(res.status),
          progress: 0,
          progressStep: 0,
          progressMessage: "",
          createdAt: res.createdAt,
        };
        setJob(initialJob);

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
    setPipelineModel(null);
  }, [stopPolling]);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  return {
    status,
    job,
    artifacts,
    error,
    errorCode,
    pipelineResult,
    pipelineModel,
    startConversion,
    reset,
  };
}
