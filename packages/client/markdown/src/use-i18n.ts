"use client";
import { useTranslationBundle } from "@workbench/i18n";
import { markdownTranslationBundle } from "./i18n";
export function useMarkdownI18n() {
  return useTranslationBundle(markdownTranslationBundle);
}
