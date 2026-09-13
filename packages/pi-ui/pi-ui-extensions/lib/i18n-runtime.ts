import type { PiI18nRuntime } from "../src/i18n";
/** Reuse the same runtime binding for hooks and programmatic translation. */
export function bindPiI18nRuntime(
  bundle: Omit<PiI18nRuntime, "text" | "isLocalizableText">,
  i18n: Pick<PiI18nRuntime, "text" | "isLocalizableText">,
): PiI18nRuntime {
  return Object.freeze({ ...bundle, isLocalizableText: i18n.isLocalizableText, text: i18n.text });
}
