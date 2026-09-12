const LATEX_DISPLAY_MATH = /\\{1,2}\[([\s\S]+?)\\{1,2}\]/g;
const LATEX_INLINE_MATH = /\\{1,2}\(([^\n]+?)\\{1,2}\)/g;
const CUSTOM_DISPLAY_MATH = /\[\/math\]([\s\S]*?)\[\/math\]/g;
const CUSTOM_INLINE_MATH = /\[\/inline\]([\s\S]*?)\[\/inline\]/g;

function normalizeMathDelimiters(text: string): string {
  return text
    .replace(CUSTOM_DISPLAY_MATH, (_, body: string) => `$$${body.trim()}$$`)
    .replace(CUSTOM_INLINE_MATH, (_, body: string) => `$${body.trim()}$`)
    .replace(LATEX_INLINE_MATH, (_, body: string) => `$${body.trim()}$`)
    .replace(LATEX_DISPLAY_MATH, (_, body: string) => `$$${body}$$`);
}

/** Keep prose prices out of single-dollar math while preserving likely numeric formulas. */
function escapeCurrencyDollars(text: string): string {
  return text.replace(/(^|[^\\$])\$(?=\d)/g, (_, prefix: string, offset: number) => {
    const dollar = offset + prefix.length;
    const close = text.indexOf("$", dollar + 1);
    const body = close < 0 ? "" : text.slice(dollar + 1, close);
    const likelyMath =
      close > dollar + 1 &&
      !/\s$/.test(body) &&
      (/[_^{}\\=+*/]/.test(body) || /^\d+(?:\.\d+)?$/.test(body));
    return `${prefix}${likelyMath ? "$" : "\\$"}`;
  });
}

function normalizeProse(text: string): string {
  const inlineCode = /(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;
  let output = "";
  let cursor = 0;
  for (const match of text.matchAll(inlineCode)) {
    output += escapeCurrencyDollars(normalizeMathDelimiters(text.slice(cursor, match.index)));
    output += match[0];
    cursor = match.index + match[0].length;
  }
  return output + escapeCurrencyDollars(normalizeMathDelimiters(text.slice(cursor)));
}

/** Normalize prose delimiters without rewriting examples inside code. */
export function normalizeMarkdownText(text: string): string {
  let output = "";
  let prose = "";
  let fence: { marker: string; length: number } | undefined;
  for (const line of text.match(/[^\n]*(?:\n|$)/g) ?? []) {
    const candidate = /^(?: {0,3}> ?)*[ \t]*(?:[-+*] |\d+[.)] )?(`{3,}|~{3,})([^\n]*)/.exec(line);
    if (fence) {
      output += line;
      if (
        candidate &&
        candidate[1][0] === fence.marker &&
        candidate[1].length >= fence.length &&
        !candidate[2].trim()
      )
        fence = undefined;
    } else if (candidate || /^(?: {4}|\t)/.test(line)) {
      output += normalizeProse(prose) + line;
      prose = "";
      if (candidate) fence = { marker: candidate[1][0], length: candidate[1].length };
    } else {
      prose += line;
    }
  }
  return output + normalizeProse(prose);
}
