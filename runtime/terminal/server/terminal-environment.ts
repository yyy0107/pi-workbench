const UTF8_LOCALE_PATTERN = /utf-?8/i;
const PORTABLE_LOCALE_PATTERN = /^(?:c|posix)(?:[._-]?utf-?8)?$/i;

function localeValue(value: string | undefined): string | undefined {
  const locale = value?.trim();
  return locale || undefined;
}

function isNamedUtf8Locale(value: string | undefined): value is string {
  return Boolean(value && UTF8_LOCALE_PATTERN.test(value) && !PORTABLE_LOCALE_PATTERN.test(value));
}

/**
 * Keep the terminal on the user's named UTF-8 locale when a launcher-level
 * C/POSIX LC_ALL would otherwise make terminal programs escape Unicode names.
 */
export function terminalEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const environment = { ...source };
  const lcAll = localeValue(source.LC_ALL);
  const lcCtype = localeValue(source.LC_CTYPE);
  const lang = localeValue(source.LANG);
  const characterLocale = isNamedUtf8Locale(lcCtype)
    ? lcCtype
    : isNamedUtf8Locale(lang)
      ? lang
      : undefined;

  if (characterLocale && lcAll && PORTABLE_LOCALE_PATTERN.test(lcAll)) {
    delete environment.LC_ALL;
    environment.LC_CTYPE = characterLocale;
  } else if (characterLocale && !lcAll && lcCtype && PORTABLE_LOCALE_PATTERN.test(lcCtype)) {
    environment.LC_CTYPE = characterLocale;
  }

  return environment;
}
