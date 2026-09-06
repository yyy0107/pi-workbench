"use client";

import { usePiHostDescription } from "@workbench/agent-runtime-pi-client/host";
import { useWorkbenchBranding } from "@workbench/shell/presentation";
import { buttonVariants, SettingsRow } from "@workbench/shell/ui";
import { ArrowUpRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { usePiI18n } from "../../i18n";

const REPOSITORY_URL = "https://github.com/yyy0107/pi-workbench";

function AboutLink({ href, label, children }: { href: string; label: string; children?: ReactNode }) {
  const { t } = usePiI18n();
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t("extensions.about.openExternal", { label })}
      className={buttonVariants({ variant: "link", className: "px-0 text-muted-foreground" })}
    >
      {children}
      {label}
      <ArrowUpRightIcon aria-hidden="true" />
    </a>
  );
}

export function AboutGitHubLink() {
  return (
    <AboutLink href={REPOSITORY_URL} label="GitHub">
      <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
        <path d="M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656" />
      </svg>
    </AboutLink>
  );
}

export function AboutSettingsItem() {
  const { t } = usePiI18n();
  const { productName, productLogoUrl } = useWorkbenchBranding();
  const host = usePiHostDescription();

  return (
    <div className="divide-y divide-border border-t border-border">
      <section className="flex flex-col items-center py-8 text-center">
        {productLogoUrl ? (
          <img
            src={productLogoUrl}
            alt=""
            draggable={false}
            className="mb-4 size-[calc(var(--icon-size-md)*3)] dark:invert"
          />
        ) : null}
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">{productName}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("extensions.about.tagline")}</p>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
          {t("extensions.about.productDescription")}
        </p>
      </section>

      <div className="py-4">
        <SettingsRow label={t("extensions.about.version")} className="px-0">
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {host?.version ?? t("extensions.about.unavailable")}
          </span>
        </SettingsRow>
        <SettingsRow label={t("extensions.about.license")} className="px-0">
          <AboutLink href={`${REPOSITORY_URL}/blob/main/LICENSE`} label="MIT" />
        </SettingsRow>
        <SettingsRow label={t("extensions.about.source")} className="px-0">
          <AboutGitHubLink />
        </SettingsRow>
      </div>

      <section className="py-6">
        <h2 className="text-sm font-semibold text-foreground">{t("extensions.about.builtWith")}</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          React · TypeScript · Next.js · Electron · Node.js · Pi Coding Agent
        </p>
      </section>

      <section className="py-6">
        <h2 className="text-sm font-semibold text-foreground">
          {t("extensions.about.contribute")}
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <AboutLink href={`${REPOSITORY_URL}/issues`} label={t("extensions.about.issues")} />
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <AboutLink href={`${REPOSITORY_URL}/pulls`} label={t("extensions.about.pullRequests")} />
        </div>
      </section>
    </div>
  );
}
