"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { ThemedToken } from "shiki/core";

import { CODE_THEME_PAIRS, useAppearancePreferences, type CodeTheme } from "../../appearance";
import { shouldHighlightWorkbenchCode } from "../../code-highlighting/code-highlight-policy";
import { normalizeShikiLanguage } from "../../code-highlighting/shiki-catalog";
import { tokenStyle } from "../../code-highlighting/shiki-token-style";
import type {
  createWorkbenchCodeStream,
  WorkbenchHighlightedTokens,
} from "../../code-highlighting/shiki-highlighter";

const HighlightedLine = memo(function HighlightedLine({
  tokens,
}: {
  tokens: readonly ThemedToken[];
}) {
  return (
    <span className="line">
      {tokens.map((token, index) => (
        <span key={index} style={tokenStyle(token)}>
          {token.content}
        </span>
      ))}
    </span>
  );
});

/** One retained tokenizer per visible code surface; imports stay outside prose rendering. */
export function MarkdownCodeBlock({
  code,
  language,
  codeTheme,
}: {
  code: string;
  language: string;
  codeTheme?: CodeTheme;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const { codeTheme: preferredTheme } = useAppearancePreferences();
  const { light, dark } = CODE_THEME_PAIRS[codeTheme ?? preferredTheme];
  const lang = normalizeShikiLanguage(language);
  const enabled = visible && lang !== "plaintext" && shouldHighlightWorkbenchCode(code);
  const [session, setSession] = useState<{
    light: string;
    dark: string;
    lang: string;
    stream: Awaited<ReturnType<typeof createWorkbenchCodeStream>>;
  } | null>(null);

  useEffect(() => {
    if (visible || !root.current) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void import("../../code-highlighting/shiki-highlighter")
      .then(({ createWorkbenchCodeStream }) => createWorkbenchCodeStream(lang, light, dark))
      .then((stream) => {
        if (active) setSession({ light, dark, lang, stream });
      })
      .catch(() => {
        if (active) setSession(null);
      });
    return () => {
      active = false;
    };
  }, [enabled, light, dark, lang]);

  const tokens = useMemo<WorkbenchHighlightedTokens | null>(() => {
    if (
      !enabled ||
      !session ||
      session.light !== light ||
      session.dark !== dark ||
      session.lang !== lang
    )
      return null;
    try {
      return session.stream.update(code);
    } catch {
      return null;
    }
  }, [enabled, session, light, dark, lang, code]);

  return (
    <div ref={root} data-markdown="code-block" data-language={language}>
      <div data-markdown="code-block-body">
        <pre tabIndex={0}>
          <code>
            {tokens
              ? tokens.map((line, index) => <HighlightedLine key={index} tokens={line} />)
              : code}
          </code>
        </pre>
      </div>
    </div>
  );
}
