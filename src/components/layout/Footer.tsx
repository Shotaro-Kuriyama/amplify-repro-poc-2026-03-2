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
      <div className="mx-auto max-w-screen-2xl px-4 py-4 sm:px-6 sm:py-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          {/* Left: Links */}
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground sm:gap-4">
            <span className="font-medium text-foreground">{APP_NAME}</span>
            <Separator orientation="vertical" className="hidden h-4 sm:block" />
            <a href="/terms" className="hover:text-foreground transition-colors-fast">
              {t.footer.terms}
            </a>
            <a href="/privacy" className="hover:text-foreground transition-colors-fast">
              {t.footer.privacy}
            </a>
            <Separator orientation="vertical" className="hidden h-4 sm:block" />
            <span className="text-xs">{t.footer.copyright}</span>
          </div>

          {/* Right: Language + related tools */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="text-xs">{t.footer.relatedTools}:</span>
              <span
                className="inline-flex cursor-default items-center gap-1 opacity-50"
                title="Coming soon"
              >
                VeriFy
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </span>
              <span
                className="inline-flex cursor-default items-center gap-1 opacity-50"
                title="Coming soon"
              >
                MergiFy
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </span>
            </div>
            <Separator orientation="vertical" className="hidden h-4 sm:block" />
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleLocale}
              aria-label={`${t.footer.language}: ${locale === "ja" ? t.footer.english : t.footer.japanese}`}
              className="gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <Globe className="h-3.5 w-3.5" aria-hidden="true" />
              {locale === "ja" ? t.footer.english : t.footer.japanese}
            </Button>
          </div>
        </div>
      </div>
    </footer>
  );
}
