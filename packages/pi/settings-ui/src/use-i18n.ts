"use client";
import { useMemo } from "react";
import { useI18n, useTranslationBundle } from "@workbench/i18n";
import { piSettingsUiTranslationBundle } from "./i18n";
export function usePiSettingsI18n() {
  const runtime = useI18n();
  const scoped = useTranslationBundle(piSettingsUiTranslationBundle);
  return useMemo(() => ({ ...runtime, ...scoped }), [runtime, scoped]);
}
