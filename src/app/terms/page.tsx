"use client";

import { APP_NAME } from "@/lib/constants";
import { I18nProvider, useI18n } from "@/lib/i18n/context";
import Link from "next/link";

function TermsContent() {
  const { t } = useI18n();

  const sections = [
    { title: t.terms.section1Title, body: t.terms.section1Body },
    { title: t.terms.section2Title, body: t.terms.section2Body },
    { title: t.terms.section3Title, body: t.terms.section3Body },
    { title: t.terms.section4Title, body: t.terms.section4Body },
  ];

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-16">
      <Link
        href="/"
        className="mb-8 inline-block text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        &larr; {APP_NAME} {t.terms.backToApp}
      </Link>
      <h1 className="mb-8 text-2xl font-bold tracking-tight">{t.terms.title}</h1>
      <div className="prose prose-sm prose-slate max-w-none space-y-6 text-muted-foreground">
        {sections.map((section) => (
          <section key={section.title}>
            <h2 className="text-base font-semibold text-foreground">
              {section.title}
            </h2>
            <p>{section.body}</p>
          </section>
        ))}
      </div>
    </div>
  );
}

export default function TermsPage() {
  return (
    <I18nProvider defaultLocale="ja">
      <TermsContent />
    </I18nProvider>
  );
}
