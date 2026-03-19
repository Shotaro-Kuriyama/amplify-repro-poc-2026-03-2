"use client";

import { useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { ArtifactFormat, JobArtifact, LeadFormData, OrganizationType } from "@/types";
import { useI18n } from "@/lib/i18n/context";
import { api } from "@/lib/api/client";
import { COUNTRIES, ORGANIZATION_TYPES } from "@/lib/constants";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Download, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface DownloadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artifacts: JobArtifact[];
  jobId: string;
}

type FormValues = {
  name: string;
  email: string;
  country: string;
  organizationType: string;
  company: string;
};

export function DownloadModal({
  open,
  onOpenChange,
  artifacts,
  jobId,
}: DownloadModalProps) {
  const { t } = useI18n();
  const [selectedFormat, setSelectedFormat] = useState<ArtifactFormat>("ifc");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const schema = z.object({
    name: z.string().min(1, t.download.validation.nameRequired),
    email: z
      .string()
      .min(1, t.download.validation.emailRequired)
      .email(t.download.validation.emailInvalid),
    country: z.string().min(1, t.download.validation.countryRequired),
    organizationType: z.string().min(1, t.download.validation.orgTypeRequired),
    company: z.string().min(1, t.download.validation.companyRequired),
  });

  const {
    register,
    handleSubmit,
    setValue,
    reset: resetForm,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      email: "",
      country: "",
      organizationType: "",
      company: "",
    },
  });

  const onSubmit = useCallback(async (data: FormValues) => {
    const leadData: LeadFormData = {
      ...data,
      organizationType: data.organizationType as OrganizationType,
    };
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await api.submitLeadForm({ data: leadData, jobId });
      const blob = await api.downloadArtifact({ jobId, format: selectedFormat });

      // Trigger actual file download
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `model.${selectedFormat}`;
      a.click();
      URL.revokeObjectURL(url);

      setIsSuccess(true);
    } catch {
      setSubmitError(t.download.error);
    } finally {
      setIsSubmitting(false);
    }
  }, [jobId, selectedFormat, t.download.error]);

  const handleClose = useCallback((v: boolean) => {
    if (!v) {
      // Reset all state when closing so the modal is fresh next time
      setIsSuccess(false);
      setSubmitError(null);
      setSelectedFormat("ifc");
      resetForm();
    }
    onOpenChange(v);
  }, [onOpenChange, resetForm]);

  const formatDescriptions = t.download.formatDescriptions;

  if (isSuccess) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-sm">
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10">
              <CheckCircle2 className="h-7 w-7 text-emerald-500" />
            </div>
            <div>
              <h3 className="text-base font-semibold">{t.download.success}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {t.download.successDetail}
              </p>
              <Badge variant="secondary" className="mt-2 text-xs">
                {selectedFormat.toUpperCase()} — {formatDescriptions[selectedFormat]}
              </Badge>
            </div>
            <Button variant="outline" onClick={() => handleClose(false)}>
              {t.download.close}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.download.title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t.download.subtitle}</p>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Format selection */}
          <div className="space-y-2">
            <Label className="text-xs">{t.download.format}</Label>
            <div className="flex gap-2" role="radiogroup" aria-label={t.download.format}>
              {(["ifc", "rvt", "dwg"] as ArtifactFormat[]).map((fmt) => {
                const artifact = artifacts.find((a) => a.format === fmt);
                const isSelected = selectedFormat === fmt;
                return (
                  <button
                    key={fmt}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setSelectedFormat(fmt)}
                    className={cn(
                      "flex flex-1 flex-col items-center gap-1 rounded-lg border p-3 text-sm font-medium transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      isSelected
                        ? "border-cta bg-cta/5 text-cta"
                        : "border-border hover:border-cta/30"
                    )}
                  >
                    <span className="text-xs font-bold uppercase">{fmt}</span>
                    <span className="text-[9px] font-normal text-muted-foreground">
                      {formatDescriptions[fmt]}
                    </span>
                    {artifact && (
                      <Badge variant="secondary" className="text-[9px]">
                        {(artifact.size / 1_000_000).toFixed(1)} MB
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <Separator />

          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="dl-name" className="text-xs">
              {t.download.name}
            </Label>
            <Input
              id="dl-name"
              {...register("name")}
              className="h-9"
              aria-required="true"
              aria-invalid={!!errors.name}
            />
            {errors.name && (
              <p className="text-xs text-destructive" role="alert">{errors.name.message}</p>
            )}
          </div>

          {/* Email */}
          <div className="space-y-1.5">
            <Label htmlFor="dl-email" className="text-xs">
              {t.download.email}
            </Label>
            <Input
              id="dl-email"
              type="email"
              {...register("email")}
              className="h-9"
              aria-required="true"
              aria-invalid={!!errors.email}
            />
            {errors.email && (
              <p className="text-xs text-destructive" role="alert">{errors.email.message}</p>
            )}
          </div>

          {/* Country */}
          <div className="space-y-1.5">
            <Label htmlFor="dl-country" className="text-xs">{t.download.country}</Label>
            <Select onValueChange={(v: string | null) => { if (v) setValue("country", v); }}>
              <SelectTrigger className="h-9" id="dl-country" aria-required="true">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COUNTRIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {t.download.countries[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.country && (
              <p className="text-xs text-destructive" role="alert">{errors.country.message}</p>
            )}
          </div>

          {/* Organization type */}
          <div className="space-y-1.5">
            <Label htmlFor="dl-orgtype" className="text-xs">{t.download.organizationType}</Label>
            <Select onValueChange={(v: string | null) => { if (v) setValue("organizationType", v); }}>
              <SelectTrigger className="h-9" id="dl-orgtype" aria-required="true">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ORGANIZATION_TYPES.map((o) => (
                  <SelectItem key={o} value={o}>
                    {t.download.orgTypes[o]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.organizationType && (
              <p className="text-xs text-destructive" role="alert">
                {errors.organizationType.message}
              </p>
            )}
          </div>

          {/* Company */}
          <div className="space-y-1.5">
            <Label htmlFor="dl-company" className="text-xs">
              {t.download.company}
            </Label>
            <Input
              id="dl-company"
              {...register("company")}
              className="h-9"
              aria-required="true"
              aria-invalid={!!errors.company}
            />
            {errors.company && (
              <p className="text-xs text-destructive" role="alert">
                {errors.company.message}
              </p>
            )}
          </div>

          {/* Error message */}
          {submitError && (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {submitError}
            </div>
          )}

          <Button
            type="submit"
            className="w-full gap-2 bg-cta text-cta-foreground hover:bg-cta/90"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="h-4 w-4" aria-hidden="true" />
            )}
            {t.download.submit}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
