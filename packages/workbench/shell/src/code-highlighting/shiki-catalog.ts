import type { LanguageInput, ThemeInput } from "shiki/core";

import type { WorkbenchCodeTheme } from "../appearance";

const SHIKI_LANGUAGE_LOADERS = {
  c: () => import("@shikijs/langs/c"),
  cpp: () => import("@shikijs/langs/cpp"),
  csharp: () => import("@shikijs/langs/csharp"),
  css: () => import("@shikijs/langs/css"),
  diff: () => import("@shikijs/langs/diff"),
  dockerfile: () => import("@shikijs/langs/dockerfile"),
  go: () => import("@shikijs/langs/go"),
  graphql: () => import("@shikijs/langs/graphql"),
  html: () => import("@shikijs/langs/html"),
  java: () => import("@shikijs/langs/java"),
  javascript: () => import("@shikijs/langs/javascript"),
  json: () => import("@shikijs/langs/json"),
  jsonc: () => import("@shikijs/langs/jsonc"),
  jsx: () => import("@shikijs/langs/jsx"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  markdown: () => import("@shikijs/langs/markdown"),
  mdx: () => import("@shikijs/langs/mdx"),
  php: () => import("@shikijs/langs/php"),
  python: () => import("@shikijs/langs/python"),
  ruby: () => import("@shikijs/langs/ruby"),
  rust: () => import("@shikijs/langs/rust"),
  shellscript: () => import("@shikijs/langs/shellscript"),
  sql: () => import("@shikijs/langs/sql"),
  swift: () => import("@shikijs/langs/swift"),
  toml: () => import("@shikijs/langs/toml"),
  tsx: () => import("@shikijs/langs/tsx"),
  typescript: () => import("@shikijs/langs/typescript"),
  vue: () => import("@shikijs/langs/vue"),
  xml: () => import("@shikijs/langs/xml"),
  yaml: () => import("@shikijs/langs/yaml"),
} as const satisfies Record<string, LanguageInput>;

export type WorkbenchShikiLanguage = keyof typeof SHIKI_LANGUAGE_LOADERS | "plaintext";

const LANGUAGE_ALIASES: Readonly<Record<string, WorkbenchShikiLanguage>> = {
  bash: "shellscript",
  c: "c",
  "c#": "csharp",
  cs: "csharp",
  docker: "dockerfile",
  gql: "graphql",
  js: "javascript",
  md: "markdown",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "shellscript",
  shell: "shellscript",
  text: "plaintext",
  ts: "typescript",
  txt: "plaintext",
  yml: "yaml",
  zsh: "shellscript",
};

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, WorkbenchShikiLanguage>> = {
  bash: "shellscript",
  c: "c",
  cc: "cpp",
  cjs: "javascript",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  cts: "typescript",
  cxx: "cpp",
  diff: "diff",
  go: "go",
  gql: "graphql",
  graphql: "graphql",
  h: "c",
  hh: "cpp",
  hpp: "cpp",
  htm: "html",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsonc: "jsonc",
  jsx: "jsx",
  kt: "kotlin",
  kts: "kotlin",
  md: "markdown",
  mdx: "mdx",
  mjs: "javascript",
  mts: "typescript",
  patch: "diff",
  php: "php",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "shellscript",
  sql: "sql",
  swift: "swift",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  vue: "vue",
  xml: "xml",
  xsl: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "shellscript",
};

const SHIKI_THEME_LOADERS = {
  "ayu-dark": () => import("@shikijs/themes/ayu-dark"),
  "catppuccin-frappe": () => import("@shikijs/themes/catppuccin-frappe"),
  "catppuccin-latte": () => import("@shikijs/themes/catppuccin-latte"),
  "catppuccin-macchiato": () => import("@shikijs/themes/catppuccin-macchiato"),
  "catppuccin-mocha": () => import("@shikijs/themes/catppuccin-mocha"),
  "dark-plus": () => import("@shikijs/themes/dark-plus"),
  dracula: () => import("@shikijs/themes/dracula"),
  "dracula-soft": () => import("@shikijs/themes/dracula-soft"),
  "everforest-dark": () => import("@shikijs/themes/everforest-dark"),
  "everforest-light": () => import("@shikijs/themes/everforest-light"),
  "github-dark": () => import("@shikijs/themes/github-dark"),
  "github-dark-dimmed": () => import("@shikijs/themes/github-dark-dimmed"),
  "github-dark-high-contrast": () => import("@shikijs/themes/github-dark-high-contrast"),
  "github-light": () => import("@shikijs/themes/github-light"),
  "github-light-high-contrast": () => import("@shikijs/themes/github-light-high-contrast"),
  "gruvbox-dark-medium": () => import("@shikijs/themes/gruvbox-dark-medium"),
  "gruvbox-light-medium": () => import("@shikijs/themes/gruvbox-light-medium"),
  "kanagawa-dragon": () => import("@shikijs/themes/kanagawa-dragon"),
  "kanagawa-lotus": () => import("@shikijs/themes/kanagawa-lotus"),
  "kanagawa-wave": () => import("@shikijs/themes/kanagawa-wave"),
  "light-plus": () => import("@shikijs/themes/light-plus"),
  "material-theme": () => import("@shikijs/themes/material-theme"),
  "material-theme-lighter": () => import("@shikijs/themes/material-theme-lighter"),
  "material-theme-ocean": () => import("@shikijs/themes/material-theme-ocean"),
  "material-theme-palenight": () => import("@shikijs/themes/material-theme-palenight"),
  "min-dark": () => import("@shikijs/themes/min-dark"),
  "min-light": () => import("@shikijs/themes/min-light"),
  monokai: () => import("@shikijs/themes/monokai"),
  "night-owl": () => import("@shikijs/themes/night-owl"),
  nord: () => import("@shikijs/themes/nord"),
  "one-dark-pro": () => import("@shikijs/themes/one-dark-pro"),
  "one-light": () => import("@shikijs/themes/one-light"),
  "rose-pine": () => import("@shikijs/themes/rose-pine"),
  "rose-pine-dawn": () => import("@shikijs/themes/rose-pine-dawn"),
  "rose-pine-moon": () => import("@shikijs/themes/rose-pine-moon"),
  "slack-dark": () => import("@shikijs/themes/slack-dark"),
  "slack-ochin": () => import("@shikijs/themes/slack-ochin"),
  "solarized-dark": () => import("@shikijs/themes/solarized-dark"),
  "solarized-light": () => import("@shikijs/themes/solarized-light"),
  "synthwave-84": () => import("@shikijs/themes/synthwave-84"),
  "tokyo-night": () => import("@shikijs/themes/tokyo-night"),
  vesper: () => import("@shikijs/themes/vesper"),
  "vitesse-dark": () => import("@shikijs/themes/vitesse-dark"),
  "vitesse-light": () => import("@shikijs/themes/vitesse-light"),
} as const satisfies Record<WorkbenchCodeTheme, ThemeInput>;

export function normalizeShikiLanguage(language: string): WorkbenchShikiLanguage {
  const normalized = language.trim().toLocaleLowerCase();
  if (!normalized || normalized === "unknown" || normalized === "plain") return "plaintext";

  const aliased = LANGUAGE_ALIASES[normalized];
  if (aliased) return aliased;
  return normalized in SHIKI_LANGUAGE_LOADERS
    ? (normalized as keyof typeof SHIKI_LANGUAGE_LOADERS)
    : "plaintext";
}

export function languageForFilename(filename: string): WorkbenchShikiLanguage {
  const basename = filename.split(/[\\/]/).at(-1)?.toLocaleLowerCase() ?? "";
  if (basename === "dockerfile") return "dockerfile";

  const extension = basename.split(".").at(-1) ?? "";
  return LANGUAGE_BY_EXTENSION[extension] ?? "plaintext";
}

export function getShikiLanguageLoader(
  language: WorkbenchShikiLanguage,
): LanguageInput | undefined {
  return language === "plaintext" ? undefined : SHIKI_LANGUAGE_LOADERS[language];
}

export function getShikiThemeLoader(theme: WorkbenchCodeTheme): ThemeInput {
  return SHIKI_THEME_LOADERS[theme];
}
