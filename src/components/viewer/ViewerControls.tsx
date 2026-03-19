"use client";

import { useI18n } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import { RotateCcw, Box, Grid3x3 } from "lucide-react";
import type { ConversionSettings } from "@/types";

interface ViewerControlsProps {
  settings: ConversionSettings;
  onSettingsChange: (settings: ConversionSettings) => void;
  onResetView: () => void;
}

export function ViewerControls({
  settings,
  onSettingsChange,
  onResetView,
}: ViewerControlsProps) {
  const { t } = useI18n();

  return (
    <div className="absolute bottom-3 right-3 flex gap-1.5">
      <Button
        variant={settings.cameraMode === "perspective" ? "default" : "outline"}
        size="icon-sm"
        onClick={() => onSettingsChange({ ...settings, cameraMode: "perspective" })}
        title={t.settings.perspective}
        className="bg-white/80 backdrop-blur-sm hover:bg-white"
      >
        <Box className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant={settings.cameraMode === "orthographic" ? "default" : "outline"}
        size="icon-sm"
        onClick={() => onSettingsChange({ ...settings, cameraMode: "orthographic" })}
        title={t.settings.orthographic}
        className="bg-white/80 backdrop-blur-sm hover:bg-white"
      >
        <Grid3x3 className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        onClick={onResetView}
        title={t.settings.resetView}
        className="bg-white/80 backdrop-blur-sm hover:bg-white"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
