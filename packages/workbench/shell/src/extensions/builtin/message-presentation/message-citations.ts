import type { Source } from "../../../elements/inline-citation";

interface MessageCitationPart {
  type?: string;
  kind?: string;
  sourceType?: string;
  url?: string;
  title?: string;
  filename?: string;
  mediaType?: string;
}

function partKind(part: MessageCitationPart): string | undefined {
  return part.kind ?? part.type;
}

export interface MessageCitationLayout {
  byTextPart: ReadonlyMap<number, readonly Source[]>;
  inlineSourcePartIndices: ReadonlySet<number>;
}

function urlCitation(part: MessageCitationPart): Source | undefined {
  if (partKind(part) !== "source" || part.sourceType === "document" || !part.url) return undefined;

  try {
    const url = new URL(part.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;

    const domain = url.hostname.replace(/^www\./i, "");
    if (!domain) return undefined;

    return {
      domain,
      title: part.title || domain,
      snippet: part.url,
      url: part.url,
    };
  } catch {
    return undefined;
  }
}

function documentCitation(part: MessageCitationPart): Source | undefined {
  if (partKind(part) !== "source" || part.url || !part.title) return undefined;

  const descriptor = part.filename || part.mediaType || part.title;
  return {
    domain: descriptor,
    title: part.title,
    snippet: descriptor,
  };
}

function inlineCitationSource(part: MessageCitationPart): Source | undefined {
  return urlCitation(part) ?? documentCitation(part);
}

/**
 * assistant-ui source parts do not carry a character offset. Associate each
 * source with the nearest text part before it so the reference remains stable
 * across streaming updates and mixed tool/text messages.
 */
export function messageCitationLayout(
  parts: readonly MessageCitationPart[],
): MessageCitationLayout {
  const byTextPart = new Map<number, Source[]>();
  const inlineSourcePartIndices = new Set<number>();
  let nearestTextPartIndex: number | undefined;

  parts.forEach((part, index) => {
    if (partKind(part) === "text") {
      nearestTextPartIndex = index;
      return;
    }

    if (partKind(part) !== "source" || nearestTextPartIndex === undefined) return;
    const source = inlineCitationSource(part);
    if (!source) return;

    const sources = byTextPart.get(nearestTextPartIndex);
    if (sources) sources.push(source);
    else byTextPart.set(nearestTextPartIndex, [source]);
    inlineSourcePartIndices.add(index);
  });

  return { byTextPart, inlineSourcePartIndices };
}
