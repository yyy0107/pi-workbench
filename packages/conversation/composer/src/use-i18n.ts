"use client";
import { useMemo } from "react";
import { useI18n, useTranslationBundle } from "@workbench/i18n";
import { composerTranslationBundle } from "./i18n";
export function useComposerI18n() {
  const runtime = useI18n();
  const scoped = useTranslationBundle(composerTranslationBundle);
  return useMemo(() => ({ ...runtime, ...scoped }), [runtime, scoped]);
}
