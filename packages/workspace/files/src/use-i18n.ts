"use client";
import { useTranslationBundle } from "@workbench/i18n";
import { filesTranslationBundle } from "./i18n";
export function useFilesI18n() {
  return useTranslationBundle(filesTranslationBundle);
}
