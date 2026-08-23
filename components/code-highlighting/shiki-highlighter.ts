import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

import type { WorkbenchCodeTheme } from "@/extensions/builtin/appearance/appearance-preferences";

import {
  getShikiLanguageLoader,
  getShikiThemeLoader,
  type WorkbenchShikiLanguage,
} from "./shiki-catalog";

const highlighterPromise = createHighlighterCore({
  langs: [],
  themes: [],
  engine: createJavaScriptRegexEngine({ forgiving: true }),
});

const languageRegistrations = new Map<WorkbenchShikiLanguage, Promise<void>>();
const themeRegistrations = new Map<WorkbenchCodeTheme, Promise<void>>();
let registrationQueue = Promise.resolve();

const MAX_CACHED_HIGHLIGHTS = 8;
const MAX_CACHED_CODE_CHARACTERS = 50_000;
type HighlightedCodeTree = ReturnType<HighlighterCore["codeToHast"]>;
const highlightCache = new Map<string, Promise<HighlightedCodeTree>>();

function enqueueRegistration(register: () => Promise<void>): Promise<void> {
  const registration = registrationQueue.then(register, register);
  registrationQueue = registration.catch(() => undefined);
  return registration;
}

function ensureLanguage(
  highlighter: HighlighterCore,
  language: WorkbenchShikiLanguage,
): Promise<void> {
  const loader = getShikiLanguageLoader(language);
  if (!loader || highlighter.getLoadedLanguages().includes(language)) return Promise.resolve();

  const existing = languageRegistrations.get(language);
  if (existing) return existing;

  const registration = enqueueRegistration(async () => {
    if (!highlighter.getLoadedLanguages().includes(language)) {
      await highlighter.loadLanguage(loader);
    }
  });
  languageRegistrations.set(language, registration);
  void registration.catch(() => languageRegistrations.delete(language));
  return registration;
}

function ensureTheme(highlighter: HighlighterCore, theme: WorkbenchCodeTheme): Promise<void> {
  if (highlighter.getLoadedThemes().includes(theme)) return Promise.resolve();

  const existing = themeRegistrations.get(theme);
  if (existing) return existing;

  const registration = enqueueRegistration(async () => {
    if (!highlighter.getLoadedThemes().includes(theme)) {
      await highlighter.loadTheme(getShikiThemeLoader(theme));
    }
  });
  themeRegistrations.set(theme, registration);
  void registration.catch(() => themeRegistrations.delete(theme));
  return registration;
}

async function highlightUncached(
  code: string,
  language: WorkbenchShikiLanguage,
  lightTheme: WorkbenchCodeTheme,
  darkTheme: WorkbenchCodeTheme,
): Promise<HighlightedCodeTree> {
  const highlighter = await highlighterPromise;
  await Promise.all([
    ensureLanguage(highlighter, language),
    ensureTheme(highlighter, lightTheme),
    ensureTheme(highlighter, darkTheme),
  ]);

  return highlighter.codeToHast(code, {
    lang: language,
    themes: { light: lightTheme, dark: darkTheme },
    defaultColor: "light-dark()",
  });
}

export function highlightWorkbenchCode(
  code: string,
  language: WorkbenchShikiLanguage,
  lightTheme: WorkbenchCodeTheme,
  darkTheme: WorkbenchCodeTheme,
): Promise<HighlightedCodeTree> {
  if (code.length > MAX_CACHED_CODE_CHARACTERS) {
    return highlightUncached(code, language, lightTheme, darkTheme);
  }

  const cacheKey = `${language}\0${lightTheme}\0${darkTheme}\0${code}`;
  const cached = highlightCache.get(cacheKey);
  if (cached) {
    highlightCache.delete(cacheKey);
    highlightCache.set(cacheKey, cached);
    return cached;
  }

  const highlight = highlightUncached(code, language, lightTheme, darkTheme);
  highlightCache.set(cacheKey, highlight);
  while (highlightCache.size > MAX_CACHED_HIGHLIGHTS) {
    const oldestKey = highlightCache.keys().next().value;
    if (oldestKey === undefined) break;
    highlightCache.delete(oldestKey);
  }
  void highlight.catch(() => {
    if (highlightCache.get(cacheKey) === highlight) highlightCache.delete(cacheKey);
  });
  return highlight;
}
