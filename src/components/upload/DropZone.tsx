"use client";

import { useCallback, useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { useI18n } from "@/lib/i18n/context";
import { ACCEPTED_FILE_TYPES, MAX_FILE_SIZE } from "@/lib/constants";
import { Upload, FileUp, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface DropZoneProps {
  onFilesAdded: (files: File[]) => void;
  disabled?: boolean;
}

export function DropZone({ onFilesAdded, disabled }: DropZoneProps) {
  const { t } = useI18n();
  const [rejectMessage, setRejectMessage] = useState<string | null>(null);

  const onDrop = useCallback(
    (acceptedFiles: File[], rejections: FileRejection[]) => {
      // Clear previous reject message
      setRejectMessage(null);

      if (rejections.length > 0) {
        const firstError = rejections[0].errors[0];
        if (firstError?.code === "file-too-large") {
          setRejectMessage(t.upload.tooLarge);
        } else if (firstError?.code === "file-invalid-type") {
          setRejectMessage(t.upload.invalidType);
        } else {
          setRejectMessage(t.upload.invalidType);
        }
        // Auto-clear after 4s
        setTimeout(() => setRejectMessage(null), 4000);
      }

      if (acceptedFiles.length > 0) {
        onFilesAdded(acceptedFiles);
      }
    },
    [onFilesAdded, t]
  );

  const { getRootProps, getInputProps, isDragActive, isDragReject } =
    useDropzone({
      onDrop,
      accept: ACCEPTED_FILE_TYPES,
      maxSize: MAX_FILE_SIZE,
      disabled,
      multiple: true,
    });

  return (
    <div className="space-y-2">
      <div
        {...getRootProps()}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={t.upload.description}
        className={cn(
          "group relative flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 transition-all duration-200 sm:px-6 sm:py-10",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          isDragActive &&
            !isDragReject &&
            "border-cta bg-cta/5 scale-[1.01]",
          (isDragReject || rejectMessage) &&
            "border-destructive bg-destructive/5",
          !isDragActive &&
            !isDragReject &&
            !rejectMessage &&
            "border-border hover:border-cta/40 hover:bg-muted/40",
          disabled && "pointer-events-none opacity-50"
        )}
      >
        <input {...getInputProps()} />

        <div
          className={cn(
            "mb-4 flex h-12 w-12 items-center justify-center rounded-full transition-colors duration-200",
            isDragReject
              ? "bg-destructive/10 text-destructive"
              : isDragActive
                ? "bg-cta/10 text-cta"
                : "bg-muted text-muted-foreground group-hover:bg-cta/10 group-hover:text-cta"
          )}
        >
          {isDragReject ? (
            <AlertCircle className="h-6 w-6" />
          ) : isDragActive ? (
            <FileUp className="h-6 w-6" />
          ) : (
            <Upload className="h-6 w-6" />
          )}
        </div>

        <p className="text-sm font-medium text-foreground">
          {isDragReject
            ? t.upload.invalidType
            : isDragActive
              ? t.upload.dragActive
              : t.upload.title}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {isDragActive || isDragReject ? "" : t.upload.description}
        </p>
        <p className="mt-2 text-[10px] text-muted-foreground/60">
          {t.upload.maxSize}
        </p>
      </div>

      {/* Reject message banner */}
      {rejectMessage && (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {rejectMessage}
        </div>
      )}
    </div>
  );
}
