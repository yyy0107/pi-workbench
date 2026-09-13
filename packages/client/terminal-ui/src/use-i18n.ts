"use client";
import { useMemo } from "react";
import { useI18n, useTranslationBundle } from "@workbench/i18n";
import { terminalUiTranslationBundle } from "./i18n";
export function useTerminalUiI18n() {
  const runtime = useI18n();
  const scoped = useTranslationBundle(terminalUiTranslationBundle);
  return useMemo(() => ({ ...runtime, ...scoped }), [runtime, scoped]);
}
