"use client";
import { useTranslationBundle } from "@workbench/i18n";
import { reviewTranslationBundle } from "./i18n";
export function useReviewI18n() {
  return useTranslationBundle(reviewTranslationBundle);
}
