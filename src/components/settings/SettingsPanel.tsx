"use client";

import type { ConversionSettings } from "@/types";
import { useI18n } from "@/lib/i18n/context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { RotateCcw, Box, Grid3x3 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SettingsPanelProps {
  settings: ConversionSettings;
  onSettingsChange: (settings: ConversionSettings) => void;
  onResetView: () => void;
  disabled?: boolean;
}

export function SettingsPanel({
  settings,
  onSettingsChange,
  onResetView,
  disabled,
}: SettingsPanelProps) {
  const { t } = useI18n();

  const update = (partial: Partial<ConversionSettings>) => {
    onSettingsChange({ ...settings, ...partial });
  };

  return (
    <div className={cn("space-y-5", disabled && "pointer-events-none opacity-50")}>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {t.settings.title}
      </h3>

      {/* Scale */}
      <div className="space-y-2">
        <Label htmlFor="setting-scale" className="text-xs text-muted-foreground">{t.settings.scale}</Label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground" aria-hidden="true">1 :</span>
          <Input
            id="setting-scale"
            type="number"
            value={settings.scale}
            onChange={(e) => update({ scale: Number(e.target.value) || 100 })}
            className="h-8 w-20 text-sm"
            min={1}
            max={500}
            aria-describedby="scale-help"
          />
        </div>
        <p id="scale-help" className="text-[10px] text-muted-foreground/60">{t.settings.scaleHelp}</p>
      </div>

      {/* Floor Height */}
      <div className="space-y-2">
        <Label htmlFor="setting-floor-height" className="text-xs text-muted-foreground">{t.settings.floorHeight}</Label>
        <div className="flex items-center gap-2">
          <Input
            id="setting-floor-height"
            type="number"
            value={settings.floorHeight}
            onChange={(e) => update({ floorHeight: Number(e.target.value) || 2.8 })}
            className="h-8 w-20 text-sm"
            min={2}
            max={6}
            step={0.1}
          />
          <span className="text-xs text-muted-foreground">
            {t.settings.floorHeightUnit}
          </span>
        </div>
      </div>

      <Separator />

      {/* Visibility / Opacity */}
      <div className="space-y-3">
        <Label className="text-xs text-muted-foreground">{t.settings.opacity}</Label>
        <Slider
          value={[settings.opacity * 100]}
          onValueChange={(val: number[]) => {
            update({ opacity: val[0] / 100 });
          }}
          min={0}
          max={100}
          step={5}
          className="w-full"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground/50">
          <span>0%</span>
          <span>{Math.round(settings.opacity * 100)}%</span>
          <span>100%</span>
        </div>
      </div>

      <Separator />

      {/* Camera Mode */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">{t.settings.camera}</Label>
        <div className="flex gap-1.5">
          <Button
            variant={settings.cameraMode === "perspective" ? "default" : "outline"}
            size="sm"
            onClick={() => update({ cameraMode: "perspective" })}
            aria-pressed={settings.cameraMode === "perspective"}
            className="flex-1 gap-1.5 text-xs"
          >
            <Box className="h-3 w-3" aria-hidden="true" />
            {t.settings.perspective}
          </Button>
          <Button
            variant={settings.cameraMode === "orthographic" ? "default" : "outline"}
            size="sm"
            onClick={() => update({ cameraMode: "orthographic" })}
            aria-pressed={settings.cameraMode === "orthographic"}
            className="flex-1 gap-1.5 text-xs"
          >
            <Grid3x3 className="h-3 w-3" aria-hidden="true" />
            {t.settings.orthographic}
          </Button>
        </div>
      </div>

      {/* Reset View */}
      <Button
        variant="outline"
        size="sm"
        onClick={onResetView}
        className="w-full gap-1.5 text-xs"
      >
        <RotateCcw className="h-3 w-3" />
        {t.settings.resetView}
      </Button>
    </div>
  );
}
