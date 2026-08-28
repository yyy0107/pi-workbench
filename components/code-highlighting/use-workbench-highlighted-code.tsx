"use client";

import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { jsx, jsxs } from "react/jsx-runtime";

import {
  CODE_THEME_PAIRS,
  type CodeTheme,
  type WorkbenchCodeTheme,
} from "@/services/appearance/appearance-preferences";
import { useAppearancePreferences } from "@/services/appearance/appearance-store";

import { normalizeShikiLanguage } from "./shiki-catalog";
import { shouldHighlightWorkbenchCode } from "./code-highlight-policy";

const HIGHLIGHT_DELAY_MS = 60;

interface HighlightedCodeState {
  code: string;
  darkTheme: WorkbenchCodeTheme;
  language: string;
  lightTheme: WorkbenchCodeTheme;
  node: ReactNode;
}

export function useWorkbenchHighlightedCode(
  code: string,
  language: string,
  codeThemeOverride?: CodeTheme,
): ReactNode | null {
  const { codeTheme } = useAppearancePreferences();
  const selectedTheme = codeThemeOverride ?? codeTheme;
  const { light, dark } = CODE_THEME_PAIRS[selectedTheme];
  const normalizedLanguage = normalizeShikiLanguage(language);
  const shouldHighlight = shouldHighlightWorkbenchCode(code);
  const [highlightedCode, setHighlightedCode] = useState<HighlightedCodeState | null>(null);

  useEffect(() => {
    if (!shouldHighlight) return;

    let active = true;
    const highlight = () => {
      void import("./shiki-highlighter")
        .then(({ highlightWorkbenchCode }) =>
          highlightWorkbenchCode(code, normalizedLanguage, light, dark),
        )
        .then((tree) => {
          if (!active) return;
          setHighlightedCode({
            code,
            darkTheme: dark,
            language: normalizedLanguage,
            lightTheme: light,
            node: toJsxRuntime(tree, { Fragment, jsx, jsxs }),
          });
        })
        .catch((error: unknown) => {
          console.error("[workbench-shiki] highlight failed", error);
        });
    };

    const idleCallbackId = window.requestIdleCallback?.(highlight, {
      timeout: HIGHLIGHT_DELAY_MS * 4,
    });
    const timeoutId =
      idleCallbackId === undefined ? window.setTimeout(highlight, HIGHLIGHT_DELAY_MS) : undefined;

    return () => {
      active = false;
      if (idleCallbackId !== undefined) window.cancelIdleCallback?.(idleCallbackId);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [code, dark, light, normalizedLanguage, shouldHighlight]);

  if (
    !shouldHighlight ||
    highlightedCode?.code !== code ||
    highlightedCode.language !== normalizedLanguage ||
    highlightedCode.lightTheme !== light ||
    highlightedCode.darkTheme !== dark
  ) {
    return null;
  }

  return highlightedCode.node;
}
