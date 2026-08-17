"use client";

import { LanguagesIcon } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useI18n, type Locale } from "@/i18n";
import { cn } from "@/lib/utils";

function LocaleSelector({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const { locale, setLocale, t } = useI18n();
  const nextLocale: Locale = locale === "en-US" ? "zh-CN" : "en-US";
  const currentLanguage =
    locale === "en-US"
      ? t("extensions.localeSelector.english")
      : t("extensions.localeSelector.chinese");
  const nextLanguage =
    nextLocale === "en-US"
      ? t("extensions.localeSelector.english")
      : t("extensions.localeSelector.chinese");
  const switchLabel = t("extensions.localeSelector.switchTo", { language: nextLanguage });

  return (
    <Button
      type="button"
      variant="ghost"
      size={compact ? "icon-sm" : "sm"}
      aria-label={switchLabel}
      title={switchLabel}
      className={cn(
        "text-muted-foreground hover:text-foreground",
        compact ? "md:hidden" : "w-full justify-start gap-2",
      )}
      onClick={() => {
        setLocale(nextLocale);
        router.refresh();
      }}
    >
      <LanguagesIcon className="size-4" />
      {!compact ? (
        <span>{t("extensions.localeSelector.current", { language: currentLanguage })}</span>
      ) : null}
    </Button>
  );
}

export function SidebarLocaleSelector() {
  return <LocaleSelector />;
}

export function MobileLocaleSelector() {
  return <LocaleSelector compact />;
}
