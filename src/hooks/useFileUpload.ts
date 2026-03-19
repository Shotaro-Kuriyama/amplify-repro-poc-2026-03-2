"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { UploadedFile } from "@/types";
import { api } from "@/lib/api/client";

/**
 * Generate a floor label from a numeric floor value.
 * Positive → "1F", "2F" etc.  Zero → "GF".  Negative → "B1", "B2" etc.
 */
function floorLabel(floorNum: number): string {
  if (floorNum > 0) return `${floorNum}F`;
  if (floorNum === 0) return "GF";
  return `B${Math.abs(floorNum)}`;
}

/**
 * Re-label an ordered file list based on the startFloor setting.
 * The first file gets startFloor, subsequent files increment upward.
 * If startFloor is negative (basement), the sequence goes e.g. B2 → B1 → GF → 1F → 2F.
 */
function relabelFiles(
  ordered: UploadedFile[],
  startFloor: number
): UploadedFile[] {
  return ordered.map((f, i) => {
    const floorNum = startFloor + i;
    return { ...f, floor: floorNum, label: floorLabel(floorNum) };
  });
}

export function useFileUpload() {
  // files is the single source of truth for file data AND IDs.
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const startFloorRef = useRef(1);

  // fileIds is always derived from files — never managed as separate state.
  const fileIds = useMemo(() => files.map((f) => f.id), [files]);

  const addFiles = useCallback(async (newFiles: File[]) => {
    setIsUploading(true);
    try {
      // API returns server-side IDs — these become the canonical IDs.
      const { fileIds: serverIds } = await api.uploadPlans({ files: newFiles });

      setFiles((prev) => {
        const additions: UploadedFile[] = newFiles.map((file, i) => ({
          id: serverIds[i],
          name: file.name,
          size: file.size,
          file,
          floor: 0,
          label: "",
        }));
        return relabelFiles([...prev, ...additions], startFloorRef.current);
      });
    } finally {
      setIsUploading(false);
    }
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles((prev) =>
      relabelFiles(
        prev.filter((f) => f.id !== id),
        startFloorRef.current
      )
    );
  }, []);

  const reorderFiles = useCallback((reordered: UploadedFile[]) => {
    setFiles(relabelFiles(reordered, startFloorRef.current));
  }, []);

  const applyStartFloor = useCallback((sf: number) => {
    startFloorRef.current = sf;
    setFiles((prev) => relabelFiles(prev, sf));
  }, []);

  const clearFiles = useCallback(() => {
    setFiles([]);
  }, []);

  return {
    files,
    fileIds,
    isUploading,
    addFiles,
    removeFile,
    reorderFiles,
    clearFiles,
    hasFiles: files.length > 0,
    applyStartFloor,
  };
}
