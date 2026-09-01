import "server-only";

import { cookies, headers } from "next/headers";

import {
  createI18n,
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  matchLocale,
  type Locale,
} from "@workbench/shell/i18n/runtime";

import { webAppTranslationBundle } from "@/app/i18n/bundle";

import { createExplicitWebWorkbenchSettingsService } from "./web-settings";

const WEB_SERVER_TRANSLATION_BUNDLES = Object.freeze([webAppTranslationBundle]);

function localeFromAcceptLanguage(value: string | null): Locale | undefined {
  if (!value) return undefined;

  const preferences = value
    .split(",")
    .map((entry) => {
      const [tag, ...parameters] = entry.trim().split(";");
      const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
      return {
        tag,
        quality: quality ? Number.parseFloat(quality.split("=")[1] ?? "0") : 1,
      };
    })
    .filter(({ tag, quality }) => Boolean(tag) && Number.isFinite(quality) && quality > 0)
    .sort((left, right) => right.quality - left.quality);

  for (const preference of preferences) {
    const locale = matchLocale(preference.tag);
    if (locale) return locale;
  }
  return undefined;
}

export async function getRequestLocale(): Promise<Locale> {
  const workbenchSettingsService = createExplicitWebWorkbenchSettingsService();
  if (workbenchSettingsService) {
    try {
      const storedLocale = (await workbenchSettingsService.describe()).preferences.locale;
      if (storedLocale) return storedLocale;
    } catch {
      // An unavailable explicit file must not prevent request-local locale negotiation.
    }
  }
  const cookieLocale = matchLocale((await cookies()).get(LOCALE_COOKIE_NAME)?.value);
  if (cookieLocale) return cookieLocale;

  const acceptLanguage = (await headers()).get("accept-language");
  return localeFromAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE;
}

export async function getServerI18n() {
  return createI18n(await getRequestLocale(), WEB_SERVER_TRANSLATION_BUNDLES).forBundle(
    webAppTranslationBundle,
  );
}
