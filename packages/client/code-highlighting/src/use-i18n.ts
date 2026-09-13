"use client";
import { useTranslationBundle } from "@workbench/i18n";
import { codeHighlightingTranslationBundle } from "./i18n";
export function useCodeHighlightingI18n() {
  return useTranslationBundle(codeHighlightingTranslationBundle);
}
