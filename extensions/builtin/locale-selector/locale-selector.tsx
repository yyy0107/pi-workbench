"use client";

import { CheckIcon, ChevronDownIcon, LanguagesIcon } from "lucide-react";
import { useCallback } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import {
  SettingsDropdownContent,
  SettingsDropdownItem,
  SettingsDropdownTrigger,
} from "@/components/ui/settings-control";
import { SUPPORTED_LOCALES, useI18n, type Locale } from "@/i18n";
import { cn } from "@/lib/utils";
import type { SettingsItemComponentProps } from "@/platform/extensions";

function useSelectLocale() {
  const router = useRouter();
  const { setLocale } = useI18n();

  return useCallback(
    (locale: Locale) => {
      setLocale(locale);
      router.refresh();
    },
    [router, setLocale],
  );
}

function LocaleSelector({ compact = false }: { compact?: boolean }) {
  const { locale, t } = useI18n();
  const selectLocale = useSelectLocale();
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
      size={compact ? "icon-sm" : "lg"}
      aria-label={switchLabel}
      title={switchLabel}
      className={cn(
        "text-muted-foreground hover:text-foreground",
        compact ? "md:hidden" : "w-auto justify-start gap-2 px-2.5",
      )}
      onClick={() => selectLocale(nextLocale)}
    >
      <LanguagesIcon className="size-4" />
      {!compact ? <span>{currentLanguage}</span> : null}
    </Button>
  );
}

export function SidebarLocaleSelector() {
  return <LocaleSelector />;
}

export function MobileLocaleSelector() {
  return <LocaleSelector compact />;
}

export function LocaleSettingsItem({ sectionId, itemId }: SettingsItemComponentProps) {
  const { locale, t } = useI18n();
  const selectLocale = useSelectLocale();
  const localeLabel = (value: Locale) =>
    value === "en-US"
      ? t("extensions.localeSelector.english")
      : t("extensions.localeSelector.chinese");

  return (
    <div
      data-settings-section={sectionId}
      data-settings-item={itemId}
      className="flex min-h-20 flex-wrap items-center gap-4 py-4"
    >
      <div className="min-w-0 flex-1 basis-52">
        <h3 className="text-sm font-medium">{t("extensions.localeSelector.languageTitle")}</h3>
        <p className="text-muted-foreground mt-1 text-sm leading-5">
          {t("extensions.localeSelector.languageDescription")}
        </p>
      </div>

      <DropdownMenu>
        <SettingsDropdownTrigger aria-label={t("extensions.localeSelector.selectLanguage")}>
          <span>{localeLabel(locale)}</span>
          <ChevronDownIcon className="text-muted-foreground size-3.5" />
        </SettingsDropdownTrigger>
        <SettingsDropdownContent align="end" side="bottom">
          {SUPPORTED_LOCALES.map((option) => (
            <SettingsDropdownItem key={option} onClick={() => selectLocale(option)}>
              <span className="min-w-0 flex-1">{localeLabel(option)}</span>
              {option === locale ? <CheckIcon className="size-4" /> : null}
            </SettingsDropdownItem>
          ))}
        </SettingsDropdownContent>
      </DropdownMenu>
    </div>
  );
}
