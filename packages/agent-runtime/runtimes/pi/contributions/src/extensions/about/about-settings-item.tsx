"use client";

import { usePiHostDescription } from "@workbench/agent-runtime-pi-client/host";
import { useWorkbenchBranding } from "@workbench/shell/presentation";
import { buttonVariants, SettingsRow } from "@workbench/shell/ui";
import { ArrowUpRightIcon, MessagesSquareIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  siBaseui,
  siDeepseek,
  siElectron,
  siElectronbuilder,
  siLucide,
  siNextdotjs,
  siNodedotjs,
  siRadixui,
  siReact,
  siSimpleicons,
  siTanstack,
  siTailwindcss,
  siTypescript,
} from "simple-icons";

import { usePiI18n } from "../../i18n";

const REPOSITORY_URL = "https://github.com/yyy0107/pi-workbench";
// Source: https://pi.dev/logo-auto.svg
const PI_ICON_PATH =
  "M4.959 4.959h10.562V12H12v3.521H8.48v3.521H4.959ZM8.48 8.48V12H12V8.48ZM15.521 12h3.521v7.042h-3.521Z";
const OPEN_SOURCE_PROJECTS = [
  {
    name: "Pi Coding Agent",
    license: "MIT",
    href: "https://github.com/earendil-works/pi",
    icon: PI_ICON_PATH,
  },
  { name: "React", license: "MIT", href: "https://react.dev", icon: siReact.path },
  {
    name: "TypeScript",
    license: "Apache-2.0",
    href: "https://www.typescriptlang.org",
    icon: siTypescript.path,
  },
  { name: "Next.js", license: "MIT", href: "https://nextjs.org", icon: siNextdotjs.path },
  {
    name: "Electron",
    license: "MIT",
    href: "https://www.electronjs.org",
    icon: siElectron.path,
  },
  {
    name: "Electron Builder",
    license: "MIT",
    href: "https://www.electron.build",
    icon: siElectronbuilder.path,
  },
  { name: "Node.js", license: "MIT", href: "https://nodejs.org", icon: siNodedotjs.path },
  {
    name: "Tailwind CSS",
    license: "MIT",
    href: "https://tailwindcss.com",
    icon: siTailwindcss.path,
  },
  {
    name: "assistant-ui",
    license: "MIT",
    href: "https://www.assistant-ui.com",
    icon: null,
  },
  {
    name: "DeepSeek Harness",
    license: "MIT",
    href: "https://github.com/deepseek-ai/deepseek-harness",
    icon: siDeepseek.path,
  },
  {
    name: "thinking-orbs",
    license: "MIT",
    href: "https://libraries.dev/orbs",
    icon: null,
  },
  { name: "Base UI", license: "MIT", href: "https://base-ui.com", icon: siBaseui.path },
  {
    name: "Radix UI",
    license: "MIT",
    href: "https://www.radix-ui.com",
    icon: siRadixui.path,
  },
  {
    name: "TanStack Virtual",
    license: "MIT",
    href: "https://tanstack.com/virtual",
    icon: siTanstack.path,
  },
  { name: "Lucide", license: "ISC", href: "https://lucide.dev", icon: siLucide.path },
  {
    name: "Simple Icons",
    license: "CC0-1.0",
    href: "https://simpleicons.org",
    icon: siSimpleicons.path,
  },
] as const;

function AboutLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children?: ReactNode;
}) {
  const { t } = usePiI18n();
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t("extensions.about.openExternal", { label })}
      className={buttonVariants({ variant: "link", className: "px-0!" })}
    >
      {children}
      {label}
      <ArrowUpRightIcon aria-hidden="true" />
    </a>
  );
}

function AboutGitHubLink() {
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
  const projectRows = OPEN_SOURCE_PROJECTS.map(({ name, license, href, icon }) => (
    <li key={name}>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t("extensions.about.openExternal", { label: `${name} · ${license}` })}
        className={buttonVariants({
          variant: "ghost",
          className:
            "h-auto w-full justify-start rounded-none px-0! py-2 text-primary hover:text-primary",
        })}
      >
        <span className="flex w-[var(--icon-frame-size-default)] shrink-0 items-center justify-center">
          {icon ? (
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="size-[var(--icon-size-md)] fill-current"
            >
              <path d={icon} />
            </svg>
          ) : name === "thinking-orbs" ? (
            <svg
              viewBox="0 0 32 32"
              aria-hidden="true"
              className="size-[var(--icon-size-md)] fill-none"
            >
              <path
                d="M21.3352 10.3354 6.89079 13.3354 18.0019 7.33536 1.33524 9.33536 19.3352 1.33536 1.33524 4.33536 9.33524 1.33536"
                transform="translate(4.7 8.7)"
                stroke="currentColor"
                strokeWidth="2.67"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <MessagesSquareIcon
              aria-hidden="true"
              className="size-[var(--icon-size-md)]"
              strokeWidth={3}
            />
          )}
        </span>
        <span className="min-w-0 flex-1 text-left">{name}</span>
        <span className="text-xs font-normal text-muted-foreground">{license}</span>
        <ArrowUpRightIcon aria-hidden="true" className="text-muted-foreground" />
      </a>
    </li>
  ));

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

      <section className="py-6">
        <h2 className="text-sm font-semibold text-foreground">
          {t("extensions.about.openSourceSoftware")}
        </h2>
        <ul className="mt-3 divide-y divide-border">{projectRows}</ul>
      </section>
    </div>
  );
}
