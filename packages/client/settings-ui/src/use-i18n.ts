"use client";
import { useMemo } from "react";
import { useI18n, useTranslationBundle } from "@workbench/i18n";
import { settingsUiTranslationBundle } from "./i18n";
export function useSettingsUiI18n() {
  const runtime = useI18n();
  const scoped = useTranslationBundle(settingsUiTranslationBundle);
  return useMemo(() => ({ ...runtime, ...scoped }), [runtime, scoped]);
}
