"use client";
import { useMemo } from "react";
import { useI18n, useTranslationBundle } from "@workbench/i18n";
import { conversationTranslationBundle } from "./i18n";
export function useConversationI18n() {
  const runtime = useI18n();
  const scoped = useTranslationBundle(conversationTranslationBundle);
  return useMemo(() => ({ ...runtime, ...scoped }), [runtime, scoped]);
}
