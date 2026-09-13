"use client";
import { useTranslationBundle } from "@workbench/i18n";
import { gitBranchTranslationBundle } from "./i18n";
export function useGitBranchI18n() {
  return useTranslationBundle(gitBranchTranslationBundle);
}
