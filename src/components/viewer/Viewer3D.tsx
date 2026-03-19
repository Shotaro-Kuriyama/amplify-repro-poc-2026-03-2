"use client";

import { Suspense, useRef, useCallback, useEffect, useImperativeHandle, forwardRef } from "react";
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
import type { ConversionSettings, JobStatus } from "@/types";
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
}

// Expose reset via imperative handle so parent can trigger it
interface SceneHandle {
  resetView: () => void;
}

interface SceneContentProps {
  floors: number;
  floorHeight: number;
  opacity: number;
  cameraMode: "perspective" | "orthographic";
}

const SceneContent = forwardRef<SceneHandle, SceneContentProps>(
  function SceneContent({ floors, floorHeight, opacity, cameraMode }, ref) {
    const controlsRef = useRef<OrbitControlsImpl>(null);

    useImperativeHandle(ref, () => ({
      resetView: () => {
        controlsRef.current?.reset();
      },
    }));

    return (
      <>
        {cameraMode === "perspective" ? (
          <PerspectiveCamera makeDefault position={[15, 12, 15]} fov={45} />
        ) : (
          <OrthographicCamera makeDefault position={[15, 12, 15]} zoom={30} />
        )}
        <OrbitControls
          ref={controlsRef}
          enableDamping
          dampingFactor={0.08}
          minDistance={5}
          maxDistance={50}
        />

        {/* Lighting */}
        <ambientLight intensity={0.5} />
        <directionalLight
          position={[10, 20, 10]}
          intensity={1}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
        />
        <directionalLight position={[-5, 10, -5]} intensity={0.3} />

        {/* Grid */}
        <Grid
          args={[40, 40]}
          position={[0, -0.01, 0]}
          cellSize={1}
          cellThickness={0.5}
          cellColor="#e2e8f0"
          sectionSize={5}
          sectionThickness={1}
          sectionColor="#cbd5e1"
          fadeDistance={30}
          fadeStrength={1}
        />

        {/* Environment — inside Suspense within Canvas to prevent context loss */}
        <Suspense fallback={null}>
          <Environment preset="city" />
        </Suspense>

        {/* Building — floorHeight & opacity now driven by Settings */}
        <BuildingModel floors={floors} floorHeight={floorHeight} planOpacity={opacity} />
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
}: Viewer3DProps) {
  const { t } = useI18n();
  const sceneRef = useRef<SceneHandle>(null);

  const handleResetView = useCallback(() => {
    sceneRef.current?.resetView();
  }, []);

  // When resetViewTrigger changes from parent (SettingsPanel "Reset View"), fire reset
  const prevTrigger = useRef(resetViewTrigger);
  useEffect(() => {
    if (resetViewTrigger !== prevTrigger.current) {
      prevTrigger.current = resetViewTrigger;
      sceneRef.current?.resetView();
    }
  }, [resetViewTrigger]);

  const showModel = status === "completed";
  const showProcessing = status === "processing";
  const showError = status === "failed";
  const showPlaceholder =
    status === "idle" || status === "uploading" || status === "ready";

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-border/60 bg-gradient-to-br from-slate-50 to-slate-100/80">
      {/* 3D Canvas — shown after conversion completes */}
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
            />
          </Canvas>
          <ViewerControls
            settings={settings}
            onSettingsChange={onSettingsChange}
            onResetView={handleResetView}
          />
          {/* Success badge */}
          <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-emerald-600 backdrop-blur-sm">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span className="text-xs font-medium">{t.viewer.completed}</span>
          </div>
          {/* Scale indicator */}
          <div className="absolute bottom-3 left-3 rounded-md bg-white/70 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur-sm">
            1:{settings.scale}
          </div>
        </>
      )}

      {/* Processing overlay */}
      {showProcessing && (
        <div className="flex h-full flex-col items-center justify-center gap-6 px-8">
          <div className="relative">
            <div className="h-16 w-16 animate-pulse rounded-2xl bg-cta/10" />
            <Building2 className="absolute inset-0 m-auto h-8 w-8 text-cta" />
          </div>
          <div className="w-full max-w-xs space-y-4 text-center">
            <h3 className="text-sm font-semibold text-foreground">
              {t.processing.title}
            </h3>

            {/* 4-step indicator */}
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

      {/* Error state */}
      {showError && (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10">
            <AlertTriangle className="h-7 w-7 text-destructive" />
          </div>
          <div className="text-center">
            <h3 className="text-sm font-semibold text-foreground">
              {t.status.failed}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {error ?? "不明なエラーが発生しました"}
            </p>
          </div>
        </div>
      )}

      {/* Placeholder */}
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
