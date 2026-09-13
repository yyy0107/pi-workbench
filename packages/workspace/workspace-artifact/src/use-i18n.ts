"use client";
import { useTranslationBundle } from "@workbench/i18n";
import { artifactTranslationBundle } from "./i18n";
export function useArtifactI18n() {
  return useTranslationBundle(artifactTranslationBundle);
}
