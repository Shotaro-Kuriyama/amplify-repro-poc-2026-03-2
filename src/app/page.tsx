"use client";

import { useState, useCallback, useMemo } from "react";
import { I18nProvider, useI18n } from "@/lib/i18n/context";
import { useFileUpload } from "@/hooks/useFileUpload";
import { useAmplifyJob } from "@/hooks/useAmplifyJob";
import type { ConversionSettings, JobStatus } from "@/types";
import {
  DEFAULT_SCALE,
  DEFAULT_FLOOR_HEIGHT,
  DEFAULT_OPACITY,
} from "@/lib/constants";
import { api } from "@/lib/api/client";

import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { AboutModal } from "@/components/layout/AboutModal";
import { GuidelinesModal } from "@/components/guidelines/GuidelinesModal";
import { DropZone } from "@/components/upload/DropZone";
import { StoryManager } from "@/components/multi-story/StoryManager";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { Viewer3D } from "@/components/viewer/Viewer3D";
import { DownloadModal } from "@/components/download/DownloadModal";
import { PipelineResultCard, PipelineErrorCard } from "@/components/pipeline/PipelineResultCard";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Play,
  Download,
  FileSpreadsheet,
  RotateCcw,
  Loader2,
  Sparkles,
  Upload,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";

function AppContent() {
  const { t } = useI18n();

  // Modals
  const [guidelinesOpen, setGuidelinesOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  // File management
  const {
    files,
    fileIds,
    isUploading,
    addFiles,
    removeFile,
    reorderFiles,
    clearFiles,
    hasFiles,
    applyStartFloor,
  } = useFileUpload();

  // Job state
  const { status: jobStatus, job, artifacts, error, errorCode, pipelineResult, startConversion, reset } =
    useAmplifyJob();

  // Start floor for multi-storey
  const [startFloor, setStartFloor] = useState("1");

  const handleStartFloorChange = useCallback((value: string) => {
    setStartFloor(value);
    applyStartFloor(Number(value));
  }, [applyStartFloor]);

  // Settings
  const [settings, setSettings] = useState<ConversionSettings>({
    scale: DEFAULT_SCALE,
    floorHeight: DEFAULT_FLOOR_HEIGHT,
    opacity: DEFAULT_OPACITY,
    cameraMode: "perspective",
  });

  // Trigger counter for resetting the 3D view (OrbitControls position/rotation/zoom)
  const [resetViewTrigger, setResetViewTrigger] = useState(0);

  // Quantities download success feedback
  const [quantitiesSuccess, setQuantitiesSuccess] = useState(false);

  // ── Derived state: the real status considering files + job lifecycle ──
  const effectiveStatus: JobStatus = useMemo(() => {
    // Job lifecycle states take priority
    if (jobStatus === "processing" || jobStatus === "completed" || jobStatus === "failed") {
      return jobStatus;
    }
    // File-based states
    if (!hasFiles) return "idle";
    if (isUploading) return "uploading";
    // Files present and idle → ready to convert
    return "ready";
  }, [jobStatus, hasFiles, isUploading]);

  const isProcessing = effectiveStatus === "processing";
  const isCompleted = effectiveStatus === "completed";
  const isFailed = effectiveStatus === "failed";
  const isReady = effectiveStatus === "ready";
  const canStart = isReady && !isProcessing;

  // ── Handlers ──
  const handleStartConversion = useCallback(async () => {
    if (!hasFiles) return;
    // Phase 8A: fileId と floorLabel の対応を API に渡す
    const fileEntries = files.map((f) => ({ fileId: f.id, floorLabel: f.label }));
    await startConversion(fileEntries, settings);
  }, [hasFiles, files, settings, startConversion]);

  const handleReset = useCallback(() => {
    reset();
    clearFiles();
    setQuantitiesSuccess(false);
  }, [reset, clearFiles]);

  const handleResetView = useCallback(() => {
    setSettings((prev) => ({ ...prev, cameraMode: "perspective" }));
    setResetViewTrigger((n) => n + 1);
  }, []);

  const handleDownloadQuantities = useCallback(async () => {
    if (!job) return;
    try {
      const res = await api.downloadQuantities({ jobId: job.id });
      const headers = ["要素", "数量", "単位", "面積 (m²)", "長さ (m)"];
      const rows = res.rows.map((r) =>
        [r.element, r.count, r.unit, r.totalArea ?? "", r.totalLength ?? ""].join(",")
      );
      const csv = [headers.join(","), ...rows].join("\n");
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "quantities.csv";
      a.click();
      URL.revokeObjectURL(url);
      setQuantitiesSuccess(true);
      setTimeout(() => setQuantitiesSuccess(false), 3000);
    } catch {
      // Silently fail for mock
    }
  }, [job]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header onOpenGuidelines={() => setGuidelinesOpen(true)} onOpenAbout={() => setAboutOpen(true)} />

      {/* Hero — only when completely idle */}
      {effectiveStatus === "idle" && (
        <div className="border-b border-border/40 bg-gradient-to-b from-white to-background">
          <div className="mx-auto max-w-screen-2xl px-4 py-8 text-center sm:px-6 sm:py-12">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-cta/10">
              <Sparkles className="h-6 w-6 text-cta" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl lg:text-3xl">
              {t.app.tagline}
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
              {t.app.description}
            </p>
          </div>
        </div>
      )}

      {/* Main content — vertical stack on mobile, horizontal on desktop */}
      <div className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col lg:flex-row">
        {/* Left sidebar → top section on mobile */}
        <aside className="w-full shrink-0 border-b border-border/40 bg-white lg:w-80 lg:border-b-0 lg:border-r">
          <div className="flex flex-col overflow-y-auto p-4 sm:p-5 lg:h-full">
            {/* Upload zone */}
            <div className="space-y-4">
              <DropZone
                onFilesAdded={addFiles}
                disabled={isProcessing || isCompleted}
              />

              {/* Uploading indicator */}
              {isUploading && (
                <div
                  className="flex items-center gap-2 rounded-lg bg-cta/5 px-3 py-2 text-xs text-cta"
                  role="status"
                >
                  <Upload className="h-3.5 w-3.5 animate-pulse" aria-hidden="true" />
                  {t.status.uploading}…
                </div>
              )}

              {/* Story Manager */}
              {hasFiles && !isUploading && (
                <StoryManager
                  files={files}
                  onReorder={reorderFiles}
                  onRemove={removeFile}
                  startFloor={startFloor}
                  onStartFloorChange={handleStartFloorChange}
                />
              )}
            </div>

            {/* Settings */}
            {hasFiles && !isUploading && (
              <>
                <Separator className="my-5" />
                <SettingsPanel
                  settings={settings}
                  onSettingsChange={setSettings}
                  onResetView={handleResetView}
                  disabled={isProcessing || isCompleted}
                />
              </>
            )}

            {/* Spacer — only on desktop to push action bar to bottom */}
            <div className="hidden flex-1 lg:block" />

            {/* Action bar */}
            <div className="mt-5 space-y-2.5 border-t border-border/40 pt-5">
              {/* Status badge */}
              <div className="flex items-center justify-between" role="status" aria-live="polite">
                <Badge
                  variant="secondary"
                  className={cn(
                    "text-[10px]",
                    effectiveStatus === "uploading" && "bg-blue-500/10 text-blue-600",
                    isReady && "bg-cta/10 text-cta",
                    isProcessing && "animate-pulse bg-cta/10 text-cta",
                    isCompleted && "bg-emerald-500/10 text-emerald-600",
                    isFailed && "bg-destructive/10 text-destructive"
                  )}
                >
                  {t.status[effectiveStatus]}
                </Badge>
                {(isCompleted || isFailed) && (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={handleReset}
                    className="gap-1 text-[10px] text-muted-foreground"
                  >
                    <RotateCcw className="h-3 w-3" aria-hidden="true" />
                    {t.actions.reset}
                  </Button>
                )}
              </div>

              {/* Failed guidance */}
              {isFailed && (
                <p className="text-[11px] text-muted-foreground">
                  {t.status.failedGuidance}
                </p>
              )}

              {/* Conversion / download actions */}
              {!isCompleted && !isFailed && (
                <Button
                  className="w-full gap-2 bg-cta text-cta-foreground hover:bg-cta/90"
                  size="lg"
                  disabled={!canStart}
                  onClick={handleStartConversion}
                  aria-busy={isProcessing}
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      {t.actions.converting}
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" aria-hidden="true" />
                      {t.actions.startConversion}
                    </>
                  )}
                </Button>
              )}

              {isCompleted && (
                <>
                  <Button
                    className="w-full gap-2 bg-cta text-cta-foreground hover:bg-cta/90"
                    size="lg"
                    onClick={() => setDownloadOpen(true)}
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    {t.actions.downloadModel}
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    className="w-full gap-2"
                    onClick={handleDownloadQuantities}
                  >
                    <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
                    {t.actions.downloadQuantities}
                  </Button>
                  {/* Quantities success feedback */}
                  {quantitiesSuccess && (
                    <div className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-600" role="status">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      {t.actions.quantitiesSuccess}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </aside>

        {/* Main viewer area */}
        <main className="flex-1 p-3 sm:p-5">
          <div className="h-full min-h-[350px] sm:min-h-[450px] lg:min-h-[500px]">
            <Viewer3D
              status={effectiveStatus}
              progress={job?.progress ?? 0}
              progressStep={job?.progressStep ?? 0}
              progressMessage={[t.processing.step1, t.processing.step2, t.processing.step3, t.processing.step4][job?.progressStep ?? 0]}
              floors={files.length || 1}
              settings={settings}
              onSettingsChange={setSettings}
              resetViewTrigger={resetViewTrigger}
              error={error}
            />
          </div>

          {/* Phase 8A: パイプライン結果サマリー（completed 時） */}
          {isCompleted && pipelineResult && (
            <div className="mt-3">
              <PipelineResultCard result={pipelineResult} />
            </div>
          )}

          {/* Phase 8A: エラー詳細（failed 時） */}
          {isFailed && (
            <div className="mt-3">
              <PipelineErrorCard errorCode={errorCode} errorMessage={error} />
            </div>
          )}
        </main>
      </div>

      <Footer />

      {/* Modals */}
      <AboutModal open={aboutOpen} onOpenChange={setAboutOpen} />
      <GuidelinesModal open={guidelinesOpen} onOpenChange={setGuidelinesOpen} />
      <DownloadModal
        open={downloadOpen}
        onOpenChange={setDownloadOpen}
        artifacts={artifacts}
        jobId={job?.id ?? ""}
      />
    </div>
  );
}

export default function Page() {
  return (
    <I18nProvider defaultLocale="ja">
      <AppContent />
    </I18nProvider>
  );
}
