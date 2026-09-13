"use client";
import { useTranslationBundle } from "@workbench/i18n";
import { fileViewTranslationBundle } from "./i18n";
export function useFileViewI18n() {
  return useTranslationBundle(fileViewTranslationBundle);
}
