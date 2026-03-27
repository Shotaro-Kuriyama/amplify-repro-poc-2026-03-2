"use client";

import type { PipelineResultSummary } from "@/types";
import { useI18n } from "@/lib/i18n/context";
import { CheckCircle2, AlertTriangle } from "lucide-react";

// ── 成功時: 解析結果サマリー ──

interface PipelineResultCardProps {
  result: PipelineResultSummary;
}

export function PipelineResultCard({ result }: PipelineResultCardProps) {
  const { t } = useI18n();
  const floor = result.floors[0]; // Phase 8A: 単一ページのみ

  return (
    <div className="rounded-lg border border-emerald-200 bg-white p-4 space-y-3">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        <h3 className="text-sm font-semibold text-foreground">
          {t.pipelineResult.title}
        </h3>
      </div>

      {/* 数量グリッド */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatBox label={t.pipelineResult.walls} value={result.stats.totalWalls} />
        <StatBox label={t.pipelineResult.openings} value={result.stats.totalOpenings} />
        <StatBox label={t.pipelineResult.rooms} value={result.stats.totalRooms} />
        {floor && (
          <StatBox label={t.pipelineResult.floor} value={floor.floorLabel} />
        )}
      </div>

      {/* メタ情報 */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
        {floor && (
          <span>
            {t.pipelineResult.sourceInfo}: {floor.pageWidth.toFixed(1)} x {floor.pageHeight.toFixed(1)} mm
          </span>
        )}
        <span>
          {t.pipelineResult.duration}: {result.stats.durationMs}ms
        </span>
      </div>
    </div>
  );
}

// ── 失敗時: エラー詳細カード ──

interface PipelineErrorCardProps {
  errorCode: string | null;
  errorMessage: string | null;
}

export function PipelineErrorCard({ errorCode, errorMessage }: PipelineErrorCardProps) {
  const { t } = useI18n();

  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-2">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-destructive" />
        <h3 className="text-sm font-semibold text-destructive">
          {t.pipelineResult.errorTitle}
        </h3>
      </div>
      {errorCode && (
        <div className="inline-block rounded bg-destructive/10 px-2 py-1 text-xs font-mono text-destructive">
          {t.pipelineResult.errorCode}: {errorCode}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {errorMessage ?? t.pipelineResult.unknownError}
      </p>
    </div>
  );
}

// ── 内部コンポーネント ──

function StatBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <p className="text-lg font-bold text-foreground">{value}</p>
    </div>
  );
}
