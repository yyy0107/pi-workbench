"use client";

import type { ComponentType } from "react";

import {
  MarkdownCodeBlockContent,
  MarkdownTextContent,
} from "../../../chat/markdown/lazy-markdown-text";
import { languageForFilename } from "../../../code-highlighting/shiki-catalog";

import type { ArtifactDescriptor, ArtifactRendererKind } from "./artifact-preview-service";

export interface ArtifactRendererProps {
  artifact: ArtifactDescriptor;
  mode: "rendered" | "source";
}

function TextArtifactRenderer({ artifact }: ArtifactRendererProps) {
  return (
    <pre className="size-full overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-6">
      {artifact.content ?? ""}
    </pre>
  );
}

function MarkdownArtifactRenderer({ artifact }: ArtifactRendererProps) {
  return (
    <div className="size-full overflow-auto px-6 py-5">
      <MarkdownTextContent text={artifact.content ?? ""} defer={false} mode="static" />
    </div>
  );
}

function CodeArtifactRenderer({ artifact }: ArtifactRendererProps) {
  return (
    <div className="size-full overflow-auto p-4">
      <MarkdownCodeBlockContent
        className="aui-codex-code-preview"
        code={artifact.content ?? ""}
        language={languageForFilename(artifact.title)}
      />
    </div>
  );
}

function ImageArtifactRenderer({ artifact }: ArtifactRendererProps) {
  const source = artifact.url ?? artifact.content;
  return source ? (
    // eslint-disable-next-line @next/next/no-img-element -- artifact sources can be data URLs.
    <img src={source} alt={artifact.title} className="size-full object-contain p-4" />
  ) : null;
}

function PdfArtifactRenderer({ artifact }: ArtifactRendererProps) {
  const source = artifact.url ?? artifact.content;
  return source ? (
    <object
      data={source}
      type="application/pdf"
      aria-label={artifact.title}
      className="size-full"
    />
  ) : null;
}

function HtmlArtifactRenderer({ artifact, mode }: ArtifactRendererProps) {
  if (mode === "source") {
    return (
      <div className="size-full overflow-auto p-4">
        <MarkdownCodeBlockContent
          className="aui-codex-code-preview"
          code={artifact.content ?? ""}
          language="html"
        />
      </div>
    );
  }
  return (
    <iframe
      sandbox="allow-forms allow-scripts"
      aria-label={artifact.title}
      srcDoc={artifact.content ?? ""}
      className="size-full bg-white"
    />
  );
}

export interface ArtifactRendererDefinition {
  render: ComponentType<ArtifactRendererProps>;
  supportsAnnotation: boolean;
  supportsSource: boolean;
}

const textDefinition: ArtifactRendererDefinition = {
  render: TextArtifactRenderer,
  supportsAnnotation: true,
  supportsSource: false,
};

const codeDefinition: ArtifactRendererDefinition = {
  render: CodeArtifactRenderer,
  supportsAnnotation: true,
  supportsSource: false,
};

const markdownDefinition: ArtifactRendererDefinition = {
  render: MarkdownArtifactRenderer,
  supportsAnnotation: true,
  supportsSource: false,
};

export const artifactRendererRegistry = {
  markdown: markdownDefinition,
  code: codeDefinition,
  image: {
    render: ImageArtifactRenderer,
    supportsAnnotation: true,
    supportsSource: false,
  },
  pdf: {
    render: PdfArtifactRenderer,
    supportsAnnotation: true,
    supportsSource: false,
  },
  html: {
    render: HtmlArtifactRenderer,
    supportsAnnotation: true,
    supportsSource: true,
  },
  spreadsheet: textDefinition,
  presentation: textDefinition,
  unknown: textDefinition,
} satisfies Record<ArtifactRendererKind, ArtifactRendererDefinition>;
