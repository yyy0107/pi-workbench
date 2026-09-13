"use client";
import { useMemo } from "react";
import { useI18n, useTranslationBundle } from "@workbench/i18n";
import { workspaceTranslationBundle } from "./i18n";
/** Own labels are typed locally; foreign Surface descriptors use the installed catalog validator. */
export function useWorkspaceI18n() {
  const runtime = useI18n();
  const scoped = useTranslationBundle(workspaceTranslationBundle);
  return useMemo(() => ({ ...runtime, ...scoped }), [runtime, scoped]);
}
