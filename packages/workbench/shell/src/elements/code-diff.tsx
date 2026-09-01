"use client";

import type { ReactNode } from "react";

import { cn } from "../utils";

import { mono } from "./surfaces";

type DiffKind = "context" | "added" | "removed";

export interface DiffLine {
  kind: DiffKind;
  text: string;
}

export function DiffHeader({
  filename,
  additions,
  deletions,
  children,
}: {
  filename: string;
  additions: number;
  deletions: number;
  children?: ReactNode;
}) {
  return (
    <div className="border-border/60 bg-muted/15 flex h-9 min-w-0 items-center border-b px-3">
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="text-muted-foreground min-w-0 truncate">{filename}</span>
        <span className={cn(mono, "shrink-0 tabular-nums")}>
          <span className="text-emerald-600 dark:text-emerald-400">+{additions}</span>{" "}
          <span className="text-red-600 dark:text-red-400">-{deletions}</span>
        </span>
      </div>
      {children}
    </div>
  );
}
