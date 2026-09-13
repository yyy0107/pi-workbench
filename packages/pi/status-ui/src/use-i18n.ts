"use client";
import { useMemo } from "react";
import { useI18n, useTranslationBundle } from "@workbench/i18n";
import { statusUiTranslationBundle } from "./i18n";
export function usePiI18n() {
  const runtime = useI18n();
  const scoped = useTranslationBundle(statusUiTranslationBundle);
  return useMemo(() => ({ ...runtime, ...scoped }), [runtime, scoped]);
}
