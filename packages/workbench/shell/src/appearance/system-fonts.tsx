"use client";

import { createContext, useContext, useEffect, useState } from "react";

import { isLocalFontFamily, type LocalFontFamily } from "./appearance-preferences";

const SystemFontsContext = createContext<(() => Promise<readonly string[]>) | undefined>(undefined);
export const SystemFontsProvider = SystemFontsContext.Provider;

export function normalizeSystemFontFamilies(value: unknown): LocalFontFamily[] {
  if (!Array.isArray(value) || value.some((family) => typeof family !== "string")) {
    throw new Error("Invalid system font family list.");
  }
  return [...new Set(value.map((family: string) => `local:${family.trim()}`))].filter(
    isLocalFontFamily,
  );
}

export function useSystemFonts() {
  const getFontFamilies = useContext(SystemFontsContext);
  const [state, setState] = useState<{
    fonts: readonly LocalFontFamily[];
    status: "loading" | "ready" | "failed";
  }>({ fonts: [], status: getFontFamilies ? "loading" : "ready" });

  useEffect(() => {
    let active = true;
    setState({ fonts: [], status: getFontFamilies ? "loading" : "ready" });
    if (getFontFamilies) {
      void Promise.resolve()
        .then(getFontFamilies)
        .then(normalizeSystemFontFamilies)
        .then(
          (fonts) => {
            if (active) setState({ fonts, status: "ready" });
          },
          () => {
            if (active) setState({ fonts: [], status: "failed" });
          },
        );
    }
    return () => {
      active = false;
    };
  }, [getFontFamilies]);

  return state;
}
