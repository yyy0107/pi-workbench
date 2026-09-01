"use client";

import { useEffect, useMemo, useState } from "react";

import type { RuntimeConnection } from "@workbench/host-contracts";
import {
  createI18n,
  DEFAULT_LOCALE,
  matchLocale,
  type Locale,
} from "@workbench/shell/i18n/runtime";
import { Button } from "@workbench/shell/ui";

import { desktopRendererTranslationBundle } from "@/app/i18n/bundle";

import { DesktopWorkbench } from "./desktop-workbench";
import { bootstrapDesktopRuntimeConnection } from "./runtime-bootstrap";

type BootstrapState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; connection: RuntimeConnection }>
  | Readonly<{ status: "failed" }>;

function preferredDesktopLocale(): Locale {
  for (const language of navigator.languages) {
    const locale = matchLocale(language);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}

export function DesktopRendererApplication() {
  const [attempt, setAttempt] = useState(0);
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const [state, setState] = useState<BootstrapState>({ status: "loading" });
  const i18n = useMemo(
    () =>
      createI18n(locale, [desktopRendererTranslationBundle]).forBundle(
        desktopRendererTranslationBundle,
      ),
    [locale],
  );

  useEffect(() => {
    let active = true;
    const nextLocale = preferredDesktopLocale();
    setLocale(nextLocale);
    document.documentElement.lang = nextLocale;
    setState({ status: "loading" });
    void bootstrapDesktopRuntimeConnection().then(
      (connection) => {
        if (active) setState({ status: "ready", connection });
      },
      () => {
        if (active) setState({ status: "failed" });
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  if (state.status === "ready") {
    return <DesktopWorkbench initialLocale={locale} runtimeConnection={state.connection} />;
  }

  return (
    <main
      aria-busy={state.status === "loading"}
      className="bg-background text-foreground grid min-h-dvh place-items-center p-6"
    >
      <section className="border-border bg-card w-full max-w-md rounded-[var(--radius-xl)] border p-6 shadow-sm">
        <h1 className="text-base font-medium">{i18n.t("desktopRenderer.bootstrap.title")}</h1>
        <p className="text-muted-foreground mt-2 text-sm" role="status" aria-live="polite">
          {i18n.t(
            state.status === "loading"
              ? "desktopRenderer.bootstrap.loading"
              : "desktopRenderer.bootstrap.failed",
          )}
        </p>
        {state.status === "failed" ? (
          <Button className="mt-4" onClick={() => setAttempt((current) => current + 1)}>
            {i18n.t("desktopRenderer.bootstrap.retry")}
          </Button>
        ) : null}
      </section>
    </main>
  );
}
