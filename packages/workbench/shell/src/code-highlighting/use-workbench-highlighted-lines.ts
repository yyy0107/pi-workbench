"use client";

import { useEffect, useState } from "react";

import { CODE_THEME_PAIRS, type CodeTheme, type WorkbenchCodeTheme } from "../appearance";
import { useAppearancePreferences } from "../appearance";

import { normalizeShikiLanguage, type WorkbenchShikiLanguage } from "./shiki-catalog";
import type { WorkbenchHighlightedTokens } from "./shiki-highlighter";

const HIGHLIGHT_DELAY_MS = 40;

interface HighlightedLinesState {
  code: string;
  darkTheme: WorkbenchCodeTheme;
  grammarContextCode?: string;
  language: WorkbenchShikiLanguage;
  lightTheme: WorkbenchCodeTheme;
  tokens: WorkbenchHighlightedTokens | null;
}

export interface WorkbenchHighlightedLinesResult {
  pending: boolean;
  tokens: WorkbenchHighlightedTokens | null;
}

export function useWorkbenchHighlightedLines(
  code: string,
  language: string,
  options: Readonly<{
    enabled?: boolean;
    grammarContextCode?: string;
    theme?: CodeTheme;
  }> = {},
): WorkbenchHighlightedLinesResult {
  const { codeTheme } = useAppearancePreferences();
  const selectedTheme = options.theme ?? codeTheme;
  const { light, dark } = CODE_THEME_PAIRS[selectedTheme];
  const normalizedLanguage = normalizeShikiLanguage(language);
  const enabled = options.enabled !== false && normalizedLanguage !== "plaintext";
  const grammarContextCode = options.grammarContextCode;
  const [highlighted, setHighlighted] = useState<HighlightedLinesState | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    const highlight = () => {
      void import("./shiki-highlighter")
        .then(({ highlightWorkbenchCodeTokens }) =>
          highlightWorkbenchCodeTokens(code, normalizedLanguage, light, dark, grammarContextCode),
        )
        .then((tokens) => {
          if (!active) return;
          setHighlighted({
            code,
            darkTheme: dark,
            grammarContextCode,
            language: normalizedLanguage,
            lightTheme: light,
            tokens,
          });
        })
        .catch((error: unknown) => {
          console.error("[workbench-shiki] visible-line highlight failed", error);
          if (!active) return;
          setHighlighted({
            code,
            darkTheme: dark,
            grammarContextCode,
            language: normalizedLanguage,
            lightTheme: light,
            tokens: null,
          });
        });
    };

    const idleCallbackId = window.requestIdleCallback?.(highlight, {
      timeout: HIGHLIGHT_DELAY_MS * 5,
    });
    const timeoutId =
      idleCallbackId === undefined ? window.setTimeout(highlight, HIGHLIGHT_DELAY_MS) : undefined;

    return () => {
      active = false;
      if (idleCallbackId !== undefined) window.cancelIdleCallback?.(idleCallbackId);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [code, dark, enabled, grammarContextCode, light, normalizedLanguage]);

  if (!enabled) return { pending: false, tokens: null };

  const matches =
    highlighted?.code === code &&
    highlighted.language === normalizedLanguage &&
    highlighted.lightTheme === light &&
    highlighted.darkTheme === dark &&
    highlighted.grammarContextCode === grammarContextCode;
  return {
    pending: !matches,
    tokens: matches ? highlighted.tokens : null,
  };
}
