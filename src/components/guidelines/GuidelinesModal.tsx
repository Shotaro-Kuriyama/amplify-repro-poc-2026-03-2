"use client";

import { useI18n } from "@/lib/i18n/context";
import { DETECTABLE_ELEMENTS } from "@/lib/constants";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Upload,
  Settings2,
  Play,
  Download,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";

interface GuidelinesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GuidelinesModal({ open, onOpenChange }: GuidelinesModalProps) {
  const { t } = useI18n();

  const steps = [
    { icon: Upload, label: t.guidelines.step1 },
    { icon: Settings2, label: t.guidelines.step2 },
    { icon: Play, label: t.guidelines.step3 },
    { icon: Download, label: t.guidelines.step4 },
  ];

  // Resolve element labels from dictionary
  const elementLabels = DETECTABLE_ELEMENTS.map((key) => {
    const parts = key.split(".");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let val: any = t;
    for (const p of parts) val = val?.[p];
    return val as string;
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">{t.guidelines.title}</DialogTitle>
        </DialogHeader>

        <p className="text-sm leading-relaxed text-muted-foreground">
          {t.guidelines.description}
        </p>

        <Separator />

        {/* How to use */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold">{t.guidelines.howToUse}</h4>
          <div className="grid gap-2">
            {steps.map((step, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2.5"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cta/10 text-cta">
                  <step.icon className="h-3.5 w-3.5" />
                </div>
                <span className="text-sm">
                  <span className="mr-2 font-semibold text-cta">{i + 1}.</span>
                  {step.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        <Separator />

        {/* Detectable elements */}
        <div className="space-y-2">
          <h4 className="flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2 className="h-4 w-4 text-cta" />
            {t.guidelines.detectable}
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {elementLabels.map((label) => (
              <Badge
                key={label}
                variant="secondary"
                className="text-xs font-normal"
              >
                {label}
              </Badge>
            ))}
          </div>
        </div>

        <Separator />

        {/* Limitations */}
        <div className="space-y-2">
          <h4 className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            {t.guidelines.limitations}
          </h4>
          <ul className="space-y-1.5 pl-1">
            {t.guidelines.limitationItems.map((item, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-sm text-muted-foreground"
              >
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/40" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
