"use client";

import type { ComponentType } from "react";

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
  if (mode === "source") return <TextArtifactRenderer artifact={artifact} mode={mode} />;
  return (
    <iframe
      sandbox="allow-forms allow-scripts"
      title={artifact.title}
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

export const artifactRendererRegistry = {
  markdown: textDefinition,
  code: textDefinition,
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
