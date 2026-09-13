"use client";
import { useMemo } from "react";
import { useI18n, useTranslationBundle } from "@workbench/i18n";
import { toolboxUiTranslationBundle } from "./i18n";
export function usePiI18n() {
  const runtime = useI18n();
  const scoped = useTranslationBundle(toolboxUiTranslationBundle);
  return useMemo(() => ({ ...runtime, ...scoped }), [runtime, scoped]);
}
