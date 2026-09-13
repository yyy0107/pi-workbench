const BLOCK_MARKDOWN =
  /(?:^|\n)\s{0,3}(?:#{1,6}\s|>\s|(?:[-+*]|\d+[.)])\s|`{3,}|(?:[-*_]\s*){3,}(?:\n|$))/;
const TABLE_MARKDOWN = /(?:^|\n)\s*\|?.+\|.+\n\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?/;
const INLINE_MARKDOWN =
  /(?:\*\*\S(?:[^\n]*?\S)?\*\*|__\S(?:[^\n]*?\S)?__|~~\S(?:[^\n]*?\S)?~~|`[^`\n]+`|!?\[[^\]\n]+\]\([^\s)]+(?:\s+"[^"]*")?\)|https?:\/\/\S+)/;

export function hasRenderableMarkdown(text: string): boolean {
  return BLOCK_MARKDOWN.test(text) || TABLE_MARKDOWN.test(text) || INLINE_MARKDOWN.test(text);
}
