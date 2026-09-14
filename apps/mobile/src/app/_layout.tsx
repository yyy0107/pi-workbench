import { I18nProvider } from "@workbench/i18n";
import { matchLocale, type Locale } from "@workbench/i18n/runtime";
import { Slot } from "expo-router";
import { useCallback, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import "../platform/crypto";
import { mobileTranslationBundle } from "../i18n/index.ts";
import { MobileAppProvider } from "../state/mobile-app.tsx";

function initialLocale(): Locale {
  return matchLocale(Intl.DateTimeFormat().resolvedOptions().locale) ?? "en-US";
}

export default function RootLayout() {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const changeLocale = useCallback((nextLocale: Locale) => setLocale(nextLocale), []);
  return (
    <SafeAreaProvider>
      <I18nProvider
        locale={locale}
        onLocaleChange={changeLocale}
        bundles={[mobileTranslationBundle]}
      >
        <MobileAppProvider>
          <StatusBar style="auto" />
          <Slot />
        </MobileAppProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
