"use client";
import { useTranslationBundle } from "@workbench/i18n";
import { explorerTranslationBundle } from "./i18n";
export function useExplorerI18n() {
  return useTranslationBundle(explorerTranslationBundle);
}
