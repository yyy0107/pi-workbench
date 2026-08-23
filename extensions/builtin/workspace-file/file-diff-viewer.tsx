"use client";

import { useMemo } from "react";

import type { DiffLine } from "@/components/elements/code-diff";

import { FileCodeView, type FileCodeLineDecoration } from "./file-code-editor";

function numberedLines(lines: readonly DiffLine[]): readonly FileCodeLineDecoration[] {
  let oldLine = 1;
  let newLine = 1;
  return lines.map((line) => {
    const lineNumber = line.kind === "removed" ? oldLine : newLine;
    if (line.kind !== "added") oldLine += 1;
    if (line.kind !== "removed") newLine += 1;

    return {
      lineNumber,
      ...(line.kind === "added" || line.kind === "removed" ? { kind: line.kind } : {}),
    };
  });
}

export function FileDiffViewer({
  ariaLabel,
  name,
  lines,
}: Readonly<{
  ariaLabel: string;
  name: string;
  lines: readonly DiffLine[];
}>) {
  const value = useMemo(() => lines.map((line) => line.text).join("\n"), [lines]);
  const decorations = useMemo(() => numberedLines(lines), [lines]);

  return <FileCodeView ariaLabel={ariaLabel} name={name} value={value} decorations={decorations} />;
}
