"use client";
import { useTranslationBundle } from "@workbench/i18n";
import { agentControlsTranslationBundle } from "./i18n";
export function useAgentControlsI18n() {
  return useTranslationBundle(agentControlsTranslationBundle);
}
