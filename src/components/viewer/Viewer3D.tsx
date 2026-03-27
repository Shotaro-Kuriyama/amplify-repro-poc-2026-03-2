"use client";

import { Suspense, useRef, useCallback, useEffect, useMemo, useImperativeHandle, forwardRef } from "react";
import { Canvas } from "@react-three/fiber";
import {
  OrbitControls,
  Grid,
  Environment,
  PerspectiveCamera,
  OrthographicCamera,
} from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { ConversionSettings, JobStatus, PipelineViewerModel } from "@/types";
import { useI18n } from "@/lib/i18n/context";
import { BuildingModel } from "./BuildingModel";
import { ViewerControls } from "./ViewerControls";
import { Progress } from "@/components/ui/progress";
import { Building2, CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Viewer3DProps {
  status: JobStatus;
  progress: number;
  progressStep: number;
  progressMessage: string;
  floors: number;
  settings: ConversionSettings;
  onSettingsChange: (settings: ConversionSettings) => void;
  resetViewTrigger?: number;
  error?: string | null;
  pipelineModel?: PipelineViewerModel | null;
}

interface SceneHandle {
  resetView: () => void;
}

interface SceneBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

interface SceneContentProps {
  floors: number;
  floorHeight: number;
  opacity: number;
  cameraMode: "perspective" | "orthographic";
  pipelineModel?: PipelineViewerModel | null;
  sceneBounds: SceneBounds;
  fitKey: string;
}

function toCenteredX(xInMillimeters: number, pageWidthInMillimeters: number): number {
  return xInMillimeters / 1000 - pageWidthInMillimeters / 2000;
}

function toCenteredZ(yInMillimeters: number, pageHeightInMillimeters: number): number {
  return -(yInMillimeters / 1000 - pageHeightInMillimeters / 2000);
}

function computeSceneBounds(
  pipelineModel: PipelineViewerModel | null | undefined,
  floors: number,
  floorHeight: number
): SceneBounds {
  if (!pipelineModel || pipelineModel.floors.length === 0) {
    const totalHeight = Math.max(floors, 1) * floorHeight;
    return {
      minX: -5,
      maxX: 5,
      minY: 0,
      maxY: totalHeight,
      minZ: -4,
      maxZ: 4,
    };
  }

  let minX = Infinity;
  const minY = 0;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  pipelineModel.floors.forEach((floor, floorIndex) => {
    const baseY = floorIndex * floorHeight;
    const halfWidth = floor.pageWidth / 2000;
    const halfHeight = floor.pageHeight / 2000;

    minX = Math.min(minX, -halfWidth);
    maxX = Math.max(maxX, halfWidth);
    minZ = Math.min(minZ, -halfHeight);
    maxZ = Math.max(maxZ, halfHeight);

    floor.walls.forEach((wall) => {
      const startX = toCenteredX(wall.startX, floor.pageWidth);
      const startZ = toCenteredZ(wall.startY, floor.pageHeight);
      const endX = toCenteredX(wall.endX, floor.pageWidth);
      const endZ = toCenteredZ(wall.endY, floor.pageHeight);
      const margin = Math.max(wall.thickness / 1000, 0.05) / 2;

      minX = Math.min(minX, startX - margin, endX - margin);
      maxX = Math.max(maxX, startX + margin, endX + margin);
      minZ = Math.min(minZ, startZ - margin, endZ - margin);
      maxZ = Math.max(maxZ, startZ + margin, endZ + margin);
    });

    floor.openings.forEach((opening) => {
      const centerX = toCenteredX(opening.centerX, floor.pageWidth);
      const centerZ = toCenteredZ(opening.centerY, floor.pageHeight);
      const width = Math.max(opening.width / 1000, 0.5);
      const depth = 0.06;

      minX = Math.min(minX, centerX - width / 2);
      maxX = Math.max(maxX, centerX + width / 2);
      minZ = Math.min(minZ, centerZ - depth / 2);
      maxZ = Math.max(maxZ, centerZ + depth / 2);
    });

    maxY = Math.max(maxY, baseY + floorHeight);
  });

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
    const totalHeight = Math.max(floors, 1) * floorHeight;
    return {
      minX: -5,
      maxX: 5,
      minY: 0,
      maxY: totalHeight,
      minZ: -4,
      maxZ: 4,
    };
  }

  return {
    minX,
    maxX,
    minY,
    maxY: Math.max(maxY, floorHeight),
    minZ,
    maxZ,
  };
}

const SceneContent = forwardRef<SceneHandle, SceneContentProps>(
  function SceneContent(
    { floors, floorHeight, opacity, cameraMode, pipelineModel, sceneBounds, fitKey },
    ref
  ) {
    const controlsRef = useRef<OrbitControlsImpl>(null);
    const perspectiveCameraRef = useRef<THREE.PerspectiveCamera>(null);
    const orthographicCameraRef = useRef<THREE.OrthographicCamera>(null);
    const lastFitSignatureRef = useRef<string>("");

    const fitCameraToBounds = useCallback(() => {
      const controls = controlsRef.current;
      const camera = cameraMode === "perspective"
        ? perspectiveCameraRef.current
        : orthographicCameraRef.current;

      if (!controls || !camera) return;

      const center = new THREE.Vector3(
        (sceneBounds.minX + sceneBounds.maxX) / 2,
        (sceneBounds.minY + sceneBounds.maxY) / 2,
        (sceneBounds.minZ + sceneBounds.maxZ) / 2
      );

      const sizeX = sceneBounds.maxX - sceneBounds.minX;
      const sizeY = sceneBounds.maxY - sceneBounds.minY;
      const sizeZ = sceneBounds.maxZ - sceneBounds.minZ;
      const radius = Math.max(sizeX, sizeY, sizeZ, 1);

      const distance = Math.max(radius * 1.9, 7);
      camera.position.set(
        center.x + distance,
        center.y + distance * 0.8,
        center.z + distance
      );

      controls.target.copy(center);
      controls.minDistance = Math.max(radius * 0.15, 1.5);
      controls.maxDistance = Math.max(radius * 10, 45);

      if (camera instanceof THREE.PerspectiveCamera) {
        camera.near = 0.1;
        camera.far = Math.max(distance * 20, 300);
      } else if (camera instanceof THREE.OrthographicCamera) {
        camera.zoom = Math.min(Math.max(70 / radius, 10), 140);
      }

      camera.updateProjectionMatrix();
      camera.lookAt(center);
      controls.update();
      controls.saveState();
    }, [cameraMode, sceneBounds]);

    useImperativeHandle(ref, () => ({
      resetView: () => {
        controlsRef.current?.reset();
      },
    }));

    useEffect(() => {
      const signature = `${fitKey}:${cameraMode}`;
      if (lastFitSignatureRef.current === signature) return;
      lastFitSignatureRef.current = signature;
      fitCameraToBounds();
    }, [fitKey, cameraMode, fitCameraToBounds]);

    return (
      <>
        {cameraMode === "perspective" ? (
          <PerspectiveCamera
            ref={perspectiveCameraRef}
            makeDefault
            position={[15, 12, 15]}
            fov={45}
          />
        ) : (
          <OrthographicCamera
            ref={orthographicCameraRef}
            makeDefault
            position={[15, 12, 15]}
            zoom={30}
          />
        )}
        <OrbitControls
          ref={controlsRef}
          enableDamping
          dampingFactor={0.08}
          minDistance={1.5}
          maxDistance={120}
        />

        <ambientLight intensity={0.5} />
        <directionalLight
          position={[10, 20, 10]}
          intensity={1}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
        />
        <directionalLight position={[-5, 10, -5]} intensity={0.3} />

        <Grid
          args={[80, 80]}
          position={[0, -0.01, 0]}
          cellSize={1}
          cellThickness={0.5}
          cellColor="#e2e8f0"
          sectionSize={5}
          sectionThickness={1}
          sectionColor="#cbd5e1"
          fadeDistance={45}
          fadeStrength={1}
        />

        <Suspense fallback={null}>
          <Environment preset="city" />
        </Suspense>

        <BuildingModel
          floors={floors}
          floorHeight={floorHeight}
          planOpacity={opacity}
          pipelineModel={pipelineModel}
        />
      </>
    );
  }
);

const PROCESSING_STEP_LABELS = [
  { key: "analyzing", jaLabel: "図面解析" },
  { key: "detecting", jaLabel: "壁・開口検出" },
  { key: "generating", jaLabel: "3Dモデル生成" },
  { key: "preparing", jaLabel: "出力準備" },
];

export function Viewer3D({
  status,
  progress,
  progressStep,
  progressMessage,
  floors,
  settings,
  onSettingsChange,
  resetViewTrigger = 0,
  error,
  pipelineModel,
}: Viewer3DProps) {
  const { t } = useI18n();
  const sceneRef = useRef<SceneHandle>(null);

  const handleResetView = useCallback(() => {
    sceneRef.current?.resetView();
  }, []);

  const prevTrigger = useRef(resetViewTrigger);
  useEffect(() => {
    if (resetViewTrigger !== prevTrigger.current) {
      prevTrigger.current = resetViewTrigger;
      sceneRef.current?.resetView();
    }
  }, [resetViewTrigger]);

  const sceneBounds = useMemo(
    () => computeSceneBounds(pipelineModel, floors, settings.floorHeight),
    [pipelineModel, floors, settings.floorHeight]
  );

  const fitKey = useMemo(() => {
    if (!pipelineModel) return `fallback:${floors}`;
    const signature = pipelineModel.floors
      .map((floor) => `${floor.floorLabel}:${floor.walls.length}:${floor.openings.length}:${floor.pageWidth}x${floor.pageHeight}`)
      .join("|");
    return `${signature}:${pipelineModel.stats.totalWalls}:${pipelineModel.stats.totalOpenings}:${pipelineModel.stats.durationMs}`;
  }, [pipelineModel, floors]);

  const showModel = status === "completed";
  const showProcessing = status === "processing";
  const showError = status === "failed";
  const showPlaceholder =
    status === "idle" || status === "uploading" || status === "ready";

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-border/60 bg-gradient-to-br from-slate-50 to-slate-100/80">
      {showModel && (
        <>
          <Canvas
            shadows={{ type: THREE.PCFShadowMap }}
            className="h-full w-full"
          >
            <SceneContent
              ref={sceneRef}
              floors={floors}
              floorHeight={settings.floorHeight}
              opacity={settings.opacity}
              cameraMode={settings.cameraMode}
              pipelineModel={pipelineModel}
              sceneBounds={sceneBounds}
              fitKey={fitKey}
            />
          </Canvas>
          <ViewerControls
            settings={settings}
            onSettingsChange={onSettingsChange}
            onResetView={handleResetView}
          />
          <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-emerald-600 backdrop-blur-sm">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span className="text-xs font-medium">{t.viewer.completed}</span>
          </div>
          <div className="absolute bottom-3 left-3 rounded-md bg-white/70 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur-sm">
            1:{settings.scale}
          </div>
        </>
      )}

      {showProcessing && (
        <div className="flex h-full flex-col items-center justify-center gap-6 px-8" role="status" aria-live="polite">
          <div className="relative">
            <div className="h-16 w-16 animate-pulse rounded-2xl bg-cta/10" />
            <Building2 className="absolute inset-0 m-auto h-8 w-8 text-cta" />
          </div>
          <div className="w-full max-w-xs space-y-4 text-center">
            <h3 className="text-sm font-semibold text-foreground">
              {t.processing.title}
            </h3>

            <div className="flex items-center justify-between gap-1">
              {PROCESSING_STEP_LABELS.map((step, i) => {
                const isDone = progressStep > i;
                const isCurrent = progressStep === i;
                return (
                  <div key={step.key} className="flex flex-1 flex-col items-center gap-1.5">
                    <div
                      className={cn(
                        "h-1.5 w-full rounded-full transition-colors",
                        isDone
                          ? "bg-cta"
                          : isCurrent
                            ? "animate-pulse bg-cta/60"
                            : "bg-border"
                      )}
                    />
                    <span
                      className={cn(
                        "text-[9px] leading-tight",
                        isDone || isCurrent
                          ? "font-medium text-foreground"
                          : "text-muted-foreground/50"
                      )}
                    >
                      {step.jaLabel}
                    </span>
                  </div>
                );
              })}
            </div>

            <Progress value={progress} className="h-2" />
            <p className="text-xs text-muted-foreground">{progressMessage}</p>
            <p className="text-[10px] text-muted-foreground/50">
              {Math.round(progress)}%
            </p>
          </div>
        </div>
      )}

      {showError && (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-8" role="alert">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10">
            <AlertTriangle className="h-7 w-7 text-destructive" aria-hidden="true" />
          </div>
          <div className="text-center">
            <h3 className="text-sm font-semibold text-foreground">
              {t.status.failed}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {error ?? "不明なエラーが発生しました"}
            </p>
            <p className="mt-2 text-xs text-muted-foreground/70">
              {t.status.failedGuidance}
            </p>
          </div>
        </div>
      )}

      {showPlaceholder && (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-8">
          <div
            className={cn(
              "flex h-16 w-16 items-center justify-center rounded-2xl transition-colors",
              status === "idle"
                ? "bg-muted text-muted-foreground/40"
                : "bg-cta/10 text-cta"
            )}
          >
            <Building2 className="h-8 w-8" />
          </div>
          <p className="max-w-[240px] text-center text-sm text-muted-foreground">
            {status === "idle"
              ? t.viewer.placeholder
              : t.viewer.readyMessage ?? t.viewer.placeholder}
          </p>
        </div>
      )}
    </div>
  );
}
