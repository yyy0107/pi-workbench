import { eastAsianWidth } from "get-east-asian-width";

const MAX_CONVERSATION_TITLE_WIDTH = 24;
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function graphemeWidth(grapheme: string): 1 | 2 {
  for (const character of grapheme) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && eastAsianWidth(codePoint) === 2) return 2;
  }

  return 1;
}

/** Keeps 24 half-width characters or 12 full-width characters in conversation chrome. */
export function truncateConversationTitle(title: string): string {
  const visibleGraphemes: string[] = [];
  let visibleWidth = 0;

  for (const { segment } of graphemeSegmenter.segment(title)) {
    const nextWidth = visibleWidth + graphemeWidth(segment);
    if (nextWidth > MAX_CONVERSATION_TITLE_WIDTH) {
      return `${visibleGraphemes.join("")}...`;
    }

    visibleGraphemes.push(segment);
    visibleWidth = nextWidth;
  }

  return title;
}
