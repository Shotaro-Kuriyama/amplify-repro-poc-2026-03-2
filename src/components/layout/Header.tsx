"use client";

import { useI18n } from "@/lib/i18n/context";
import { APP_NAME, APP_VERSION } from "@/lib/constants";
import { Building2, Info, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface HeaderProps {
  onOpenGuidelines: () => void;
  onOpenAbout: () => void;
}

export function Header({ onOpenGuidelines, onOpenAbout }: HeaderProps) {
  const { t } = useI18n();

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-screen-2xl items-center justify-between px-4 sm:px-6">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Building2 className="h-4.5 w-4.5" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-foreground">
            {APP_NAME}
          </span>
          <Badge variant="secondary" className="text-[10px] font-medium text-muted-foreground">
            {APP_VERSION}
          </Badge>
        </div>

        {/* Navigation */}
        <nav className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenGuidelines}
            className="text-muted-foreground hover:text-foreground"
          >
            <BookOpen className="mr-1.5 h-3.5 w-3.5" />
            {t.header.guidelines}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenAbout}
            className="text-muted-foreground hover:text-foreground"
          >
            <Info className="mr-1.5 h-3.5 w-3.5" />
            {t.header.about}
          </Button>
        </nav>
      </div>
    </header>
  );
}
