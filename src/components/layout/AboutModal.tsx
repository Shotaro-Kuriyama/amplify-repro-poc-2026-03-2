"use client";

import { useI18n } from "@/lib/i18n/context";
import { APP_NAME, APP_VERSION } from "@/lib/constants";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Building2 } from "lucide-react";

interface AboutModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AboutModal({ open, onOpenChange }: AboutModalProps) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t.about.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold">{APP_NAME}</p>
              <p className="text-xs text-muted-foreground">
                {t.about.version}: {APP_VERSION}
              </p>
            </div>
          </div>

          <p className="text-sm leading-relaxed text-muted-foreground">
            {t.about.description}
          </p>

          <Separator />

          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground">
              {t.about.techStack}
            </p>
            <p className="text-xs text-muted-foreground">
              {t.about.techItems}
            </p>
          </div>

          <p className="rounded-md bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
            {t.about.note}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
