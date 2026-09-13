"use client";
import { useTranslationBundle } from "@workbench/i18n";
import { automationUiTranslationBundle } from "./i18n";
export function useAutomationUiI18n() {
  return useTranslationBundle(automationUiTranslationBundle);
}
