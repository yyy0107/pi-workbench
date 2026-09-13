"use client";
import { useTranslationBundle } from "@workbench/i18n";
import { browserTranslationBundle } from "./i18n";
export function useBrowserI18n() {
  return useTranslationBundle(browserTranslationBundle);
}
