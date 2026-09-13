"use client";

import type { ReactNode } from "react";

import { cn } from "@workbench/ui/utils";

import { mono, PathEllipsis } from "@workbench/ui";

type DiffKind = "context" | "added" | "removed";

export interface DiffLine {
  kind: DiffKind;
  text: string;
}

export function DiffHeader({
  filename,
  path,
  additions,
  deletions,
  children,
}: {
  filename: string;
  path?: string;
  additions: number;
  deletions: number;
  children?: ReactNode;
}) {
  return (
    <div className="border-border/60 bg-muted/15 flex h-(--button-height-default) min-w-0 items-center border-b px-3">
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <span title={filename} className="min-w-0 truncate text-foreground">
          {filename}
        </span>
        {path && <PathEllipsis text={path} className="shrink text-muted-foreground" />}
        <span className={cn(mono, "ms-auto shrink-0 tabular-nums")}>
          <span className="text-success-foreground">+{additions}</span>{" "}
          <span className="text-danger-foreground">-{deletions}</span>
        </span>
      </div>
      {children}
    </div>
  );
}
