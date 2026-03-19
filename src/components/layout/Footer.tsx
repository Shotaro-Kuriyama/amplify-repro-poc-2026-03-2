"use client";

import { useI18n, type Locale } from "@/lib/i18n/context";
import { APP_NAME } from "@/lib/constants";
import { Globe, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

export function Footer() {
  const { t, locale, setLocale } = useI18n();

  const toggleLocale = () => {
    const next: Locale = locale === "ja" ? "en" : "ja";
    setLocale(next);
  };

  return (
    <footer className="border-t border-border/60 bg-white">
      <div className="mx-auto max-w-screen-2xl px-6 py-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {/* Left: Links */}
          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{APP_NAME}</span>
            <Separator orientation="vertical" className="h-4" />
            <a href="/terms" className="hover:text-foreground transition-colors-fast">
              {t.footer.terms}
            </a>
            <a href="/privacy" className="hover:text-foreground transition-colors-fast">
              {t.footer.privacy}
            </a>
            <Separator orientation="vertical" className="h-4" />
            <span className="text-xs">{t.footer.copyright}</span>
          </div>

          {/* Right: Language + related tools */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="text-xs">{t.footer.relatedTools}:</span>
              <span
                className="inline-flex cursor-default items-center gap-1 opacity-50"
                title="Coming soon"
              >
                VeriFy
                <ExternalLink className="h-3 w-3" />
              </span>
              <span
                className="inline-flex cursor-default items-center gap-1 opacity-50"
                title="Coming soon"
              >
                MergiFy
                <ExternalLink className="h-3 w-3" />
              </span>
            </div>
            <Separator orientation="vertical" className="h-4" />
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleLocale}
              className="gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <Globe className="h-3.5 w-3.5" />
              {locale === "ja" ? t.footer.english : t.footer.japanese}
            </Button>
          </div>
        </div>
      </div>
    </footer>
  );
}
