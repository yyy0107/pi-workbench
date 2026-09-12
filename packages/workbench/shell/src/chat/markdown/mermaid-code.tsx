"use client";

import { useContext, useEffect, useId, useMemo, useState } from "react";
import { MarkdownCodeBlock } from "./markdown-code-block";
import { MarkdownFenceContext } from "./workbench-markdown";

import { useAppearancePreferences } from "../../appearance";
import { useMediaQuery } from "../../hooks/use-media-query";
import { useI18n } from "../../i18n";
import { CodexCodeHeader } from "./codex-code-header";

// Mermaid configuration is global. Keep initialization and each queued render
// together so simultaneous diagrams cannot consume another surface's theme.
let diagramQueue: Promise<unknown> = Promise.resolve();
function renderDiagram(id: string, code: string, config: import("mermaid").MermaidConfig) {
  const rendering = diagramQueue.then(async () => {
    const { default: mermaid } = await import("mermaid");
    mermaid.initialize({ ...config, startOnLoad: false });
    return mermaid.render(id, code);
  });
  diagramQueue = rendering.catch(() => undefined);
  return rendering;
}

export function MermaidCode({ code }: Readonly<{ code: string }>) {
  const { t } = useI18n();
  const preferences = useAppearancePreferences();
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const dark =
    preferences.colorMode === "dark" || (preferences.colorMode === "system" && systemDark);
  const background = dark ? preferences.darkBackgroundColor : preferences.lightBackgroundColor;
  const foreground = dark ? preferences.darkForegroundColor : preferences.lightForegroundColor;
  const accent = dark ? preferences.darkAccentColor : preferences.lightAccentColor;
  const config = useMemo(
    () => ({
      theme: "base" as const,
      securityLevel: "strict" as const,
      themeVariables: {
        darkMode: dark,
        background,
        primaryColor: background,
        primaryTextColor: foreground,
        primaryBorderColor: accent,
        lineColor: accent,
        textColor: foreground,
        fontFamily: "var(--font-sans)",
      },
    }),
    [accent, background, dark, foreground],
  );
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const incomplete = useContext(MarkdownFenceContext);
  const [result, setResult] = useState<{ svg: string; error: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    if (incomplete) return;

    // Keep the diagram engine out of ordinary Markdown/code loading.
    void renderDiagram(id, code, config).then(
      ({ svg }) => !cancelled && setResult({ svg, error: "" }),
      (error: unknown) =>
        !cancelled &&
        setResult({ svg: "", error: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, [code, config, id, incomplete]);

  return (
    <div data-markdown="mermaid-block">
      <CodexCodeHeader code={code} language="mermaid" expanded={false} />
      <div className="aui-mermaid-body" aria-busy={incomplete || !result}>
        {result?.svg && !incomplete ? (
          <div
            role="img"
            aria-label={t("assistant.codeBlock.mermaidDiagram")}
            dangerouslySetInnerHTML={{ __html: result.svg }}
          />
        ) : result?.error && !incomplete ? (
          <>
            <p role="alert" className="text-destructive">
              {t("assistant.codeBlock.mermaidError")}
            </p>
            <pre className="overflow-auto text-sm text-muted-foreground">{result.error}</pre>
            <MarkdownCodeBlock code={code} language="mermaid" />
          </>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {t("assistant.codeBlock.mermaidLoading")}
          </p>
        )}
      </div>
    </div>
  );
}
