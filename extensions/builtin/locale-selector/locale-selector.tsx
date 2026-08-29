"use client";

import { CheckIcon, ChevronDownIcon, LanguagesIcon } from "lucide-react";
import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SettingsDropdownContent,
  SettingsDropdownItem,
  SettingsDropdownTrigger,
} from "@/components/ui/settings-control";
import { SUPPORTED_LOCALES, isLocale, useI18n, type Locale } from "@/i18n";
import { cn } from "@/lib/utils";
import type { SettingsItemComponentProps } from "@/platform/extensions";

import { createLocaleDisplayName } from "./locale-display-name";

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
  const localeLabel = useMemo(() => createLocaleDisplayName(locale), [locale]);
  const selectLanguageLabel = t("extensions.localeSelector.selectLanguage");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        aria-label={selectLanguageLabel}
        title={selectLanguageLabel}
        className={cn(
          buttonVariants({ variant: "ghost", size: compact ? "icon" : "lg" }),
          "text-muted-foreground hover:text-foreground",
          compact
            ? "hidden sm:inline-flex md:hidden"
            : "group min-w-0 flex-1 shrink justify-end gap-2 px-2.5",
        )}
      >
        <LanguagesIcon aria-hidden="true" className="size-4" />
        {!compact ? (
          <>
            <span className="min-w-0 truncate">{localeLabel(locale)}</span>
            <ChevronDownIcon
              aria-hidden="true"
              className="text-muted-foreground size-3.5 shrink-0 opacity-0 transition-[opacity,transform] group-hover:opacity-50 group-focus-visible:opacity-50 group-data-popup-open:rotate-180 group-data-popup-open:opacity-50"
            />
          </>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={compact ? "end" : "start"}
        side={compact ? "bottom" : "top"}
        className="w-48"
      >
        <DropdownMenuRadioGroup
          value={locale}
          aria-label={selectLanguageLabel}
          onValueChange={(value) => {
            if (isLocale(value)) selectLocale(value);
          }}
        >
          {SUPPORTED_LOCALES.map((option) => (
            <DropdownMenuRadioItem
              key={option}
              value={option}
              className="min-h-8 px-2.5 pt-[var(--control-content-padding-block-default-start)] pb-[var(--control-content-padding-block-default-end)]"
            >
              {localeLabel(option)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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
  const localeLabel = useMemo(() => createLocaleDisplayName(locale), [locale]);

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
