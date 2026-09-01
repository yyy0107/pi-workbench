import type { ComponentProps, ReactNode } from "react";
import { ArrowRightIcon, BrainCircuitIcon, GitBranchIcon, Minimize2Icon } from "lucide-react";

import { cn } from "../utils";

import { mono } from "./surfaces";

export type ConversationSeparatorTone = "neutral" | "info" | "accent" | "danger";

export interface ConversationSeparatorProps extends Omit<ComponentProps<"div">, "children"> {
  /** Stable event kind exposed to renderers and extensions through the DOM. */
  kind: string;
  label: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  tone?: ConversationSeparatorTone;
}

const toneClasses: Record<ConversationSeparatorTone, string> = {
  neutral: "text-foreground/38",
  info: "text-blue-600/70 dark:text-blue-300/65",
  accent: "text-foreground/55",
  danger: "text-destructive/80",
};

/**
 * Locale-agnostic conversation boundary. Specialized separators only provide
 * event semantics and already-localized labels; the visual treatment stays in
 * one place as new timeline event kinds are added.
 */
export function ConversationSeparator({
  kind,
  label,
  detail,
  icon,
  tone = "neutral",
  className,
  ...props
}: ConversationSeparatorProps) {
  return (
    <div
      data-slot="conversation-separator"
      data-kind={kind}
      role="separator"
      aria-orientation="horizontal"
      className={cn("flex w-full items-center gap-2.5 py-1.5", toneClasses[tone], className)}
      {...props}
    >
      <span aria-hidden="true" className="bg-current/15 h-px min-w-4 flex-1" />
      <span className="flex min-w-0 flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 text-center">
        {icon ? <span className="shrink-0 [&>svg]:size-3">{icon}</span> : null}
        <span className="text-[11px] leading-4 font-medium">{label}</span>
        {detail ? (
          <span
            className={cn(
              mono,
              "flex min-w-0 flex-wrap items-center justify-center gap-x-1 gap-y-0.5 text-current/75",
            )}
          >
            {detail}
          </span>
        ) : null}
      </span>
      <span aria-hidden="true" className="bg-current/15 h-px min-w-4 flex-1" />
    </div>
  );
}

export interface DaySeparatorProps extends Omit<
  ConversationSeparatorProps,
  "detail" | "icon" | "kind" | "label" | "tone"
> {
  dateTime: string;
  label: ReactNode;
}

export function DaySeparator({ dateTime, label, ...props }: DaySeparatorProps) {
  return (
    <ConversationSeparator
      kind="date"
      label={
        <time dateTime={dateTime} className={mono}>
          {label}
        </time>
      }
      {...props}
    />
  );
}

export interface ModelChangeSeparatorProps extends Omit<
  ConversationSeparatorProps,
  "detail" | "icon" | "kind" | "tone"
> {
  model: ReactNode;
  previousModel?: ReactNode;
}

export function ModelChangeSeparator({
  label,
  model,
  previousModel,
  ...props
}: ModelChangeSeparatorProps) {
  return (
    <ConversationSeparator
      kind="model-change"
      tone="info"
      icon={<BrainCircuitIcon aria-hidden="true" />}
      label={label}
      detail={
        <>
          {previousModel ? (
            <>
              <span className="break-all">{previousModel}</span>
              <ArrowRightIcon aria-hidden="true" className="size-2.5 shrink-0 rtl:rotate-180" />
            </>
          ) : null}
          <span className="break-all text-current">{model}</span>
        </>
      }
      {...props}
    />
  );
}

export type CompactionSeparatorProps = Omit<ConversationSeparatorProps, "kind">;

export function CompactionSeparator({
  label,
  detail,
  icon = <Minimize2Icon aria-hidden="true" />,
  tone = "accent",
  ...props
}: CompactionSeparatorProps) {
  return (
    <ConversationSeparator
      kind="compaction"
      tone={tone}
      icon={icon}
      label={label}
      detail={detail}
      {...props}
    />
  );
}

export type ForkSeparatorProps = Omit<
  ConversationSeparatorProps,
  "detail" | "icon" | "kind" | "tone"
>;

export function ForkSeparator({ label, ...props }: ForkSeparatorProps) {
  return (
    <ConversationSeparator
      kind="fork"
      tone="info"
      icon={<GitBranchIcon aria-hidden="true" />}
      label={label}
      {...props}
    />
  );
}
