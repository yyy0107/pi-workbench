"use client";

import { CircleCheckIcon, CircleXIcon, LoaderCircleIcon } from "lucide-react";

import { ComposerCommandToken } from "../elements/composer";
import { CompactionSeparator } from "../elements/conversation-separator";
import { useI18n } from "../i18n";
import { cn } from "../utils";
import type {
  WorkbenchComposerCommandFailureReason,
  WorkbenchComposerCommandResponseDetails,
} from "@workbench/contracts/composer/request";

import { ComposerCommandArguments } from "./composer-command-arguments";
import { ComposerTokenIcon } from "./composer-token-icon";

type Translate = ReturnType<typeof useI18n>["t"];

function commandFailureDetail(
  reason: WorkbenchComposerCommandFailureReason | undefined,
  t: Translate,
): string {
  switch (reason) {
    case "context-too-small":
      return t("workbench.chat.commandResponses.failureReasons.contextTooSmall");
    case "already-compacted":
      return t("workbench.chat.commandResponses.failureReasons.alreadyCompacted");
    case "cancelled":
      return t("workbench.chat.commandResponses.failureReasons.cancelled");
    case "model-unavailable":
      return t("workbench.chat.commandResponses.failureReasons.modelUnavailable");
    case "authentication-failed":
      return t("workbench.chat.commandResponses.failureReasons.authenticationFailed");
    case "quota-exhausted":
      return t("workbench.chat.commandResponses.failureReasons.quotaExhausted");
    case "rate-limited":
      return t("workbench.chat.commandResponses.failureReasons.rateLimited");
    case "network-error":
      return t("workbench.chat.commandResponses.failureReasons.networkError");
    case "timeout":
      return t("workbench.chat.commandResponses.failureReasons.timeout");
    case "provider-unavailable":
      return t("workbench.chat.commandResponses.failureReasons.providerUnavailable");
    case "session-data-invalid":
      return t("workbench.chat.commandResponses.failureReasons.sessionDataInvalid");
    case "summary-generation-failed":
      return t("workbench.chat.commandResponses.failureReasons.summaryGenerationFailed");
    case "reload-failed":
      return t("workbench.chat.commandResponses.failureReasons.reloadFailed");
    case "unknown":
    case undefined:
      return t("workbench.chat.commandResponses.failureReasons.unknown");
  }
}

function commandResponseMessage(
  response: WorkbenchComposerCommandResponseDetails,
  t: Translate,
): string {
  const running = response.status === "running";
  const failed = response.status === "execution-failed";
  return response.commandId === "compact"
    ? running
      ? t("workbench.chat.commandResponses.compactRunning")
      : failed
        ? t("workbench.chat.commandResponses.compactFailed")
        : t("workbench.chat.commandResponses.compactSucceeded")
    : response.commandId === "reload"
      ? running
        ? t("workbench.chat.commandResponses.reloadRunning")
        : failed
          ? t("workbench.chat.commandResponses.reloadFailed")
          : t("workbench.chat.commandResponses.reloadSucceeded")
      : running
        ? t("workbench.chat.commandResponses.commandRunning", { command: response.label })
        : failed
          ? t("workbench.chat.commandResponses.commandFailed", { command: response.label })
          : t("workbench.chat.commandResponses.commandSucceeded", { command: response.label });
}

function CommandResponseIdentity({
  response,
  fieldLabels,
  className,
}: Readonly<{
  response: WorkbenchComposerCommandResponseDetails;
  fieldLabels?: Readonly<Record<string, string>>;
  className?: string;
}>) {
  return (
    <span
      data-slot="composer-command-response-command"
      className={cn("flex max-w-full min-w-0 flex-wrap items-center gap-1.5 text-xs", className)}
    >
      <ComposerCommandToken
        icon={<ComposerTokenIcon kind="builtin" />}
        label={response.label}
        data-command={response.commandId}
        className="shrink-0 text-xs leading-5"
      />
      <ComposerCommandArguments
        args={response.args}
        fieldLabels={fieldLabels}
        className="text-muted-foreground text-xs"
      />
    </span>
  );
}

export function WorkbenchComposerCommandResponse({
  response,
  compactionDetail,
}: {
  response: WorkbenchComposerCommandResponseDetails;
  compactionDetail?: string;
}) {
  const { t } = useI18n();
  const running = response.status === "running";
  const failed = response.status === "execution-failed";
  const message = commandResponseMessage(response, t);
  const Icon = running ? LoaderCircleIcon : failed ? CircleXIcon : CircleCheckIcon;
  const failureDetail = failed ? commandFailureDetail(response.failureReason, t) : undefined;
  const argumentFieldLabels =
    response.commandId === "compact"
      ? {
          customInstructions: t("workbench.chat.commandArguments.customInstructions"),
        }
      : undefined;
  const reloadConfiguration = response.reloadConfiguration;

  if (response.commandId === "compact") {
    return (
      <CompactionSeparator
        label={message}
        detail={
          <>
            {compactionDetail ? <span>{compactionDetail}</span> : null}
            {failureDetail ? (
              <span className="max-w-full font-sans tracking-normal whitespace-normal">
                {failureDetail}
              </span>
            ) : null}
            <ComposerCommandArguments
              args={response.args}
              fieldLabels={argumentFieldLabels}
              className="font-sans text-xs tracking-normal"
            />
          </>
        }
        icon={
          <Icon
            aria-hidden="true"
            className={cn(running && "animate-spin motion-reduce:animate-none")}
          />
        }
        tone={failed ? "danger" : running ? "info" : "accent"}
        role={failed ? "alert" : "status"}
        aria-orientation={undefined}
        aria-live={failed ? "assertive" : "polite"}
        aria-label={[message, compactionDetail, failureDetail].filter(Boolean).join(" ")}
        data-command={response.commandId}
        data-status={response.status}
      />
    );
  }

  return (
    <div
      role={failed ? "alert" : "status"}
      aria-live={failed ? "assertive" : "polite"}
      data-command={response.commandId}
      data-status={response.status}
      data-workbench-glass-surface=""
      className={cn(
        "flex w-fit max-w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-sm shadow-sm sm:max-w-2xl",
        failed
          ? "border-destructive/25 bg-destructive/[0.045] dark:border-destructive/30 dark:bg-destructive/[0.07]"
          : "border-border bg-muted/40",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg",
          failed ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon
          className={cn("size-4", running && "animate-spin motion-reduce:animate-none")}
          aria-hidden="true"
        />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("font-medium leading-5", failed && "text-destructive")}>{message}</p>
        {failureDetail ? (
          <p className="text-muted-foreground mt-1 leading-5">{failureDetail}</p>
        ) : null}
        {reloadConfiguration ? (
          <div
            data-slot="composer-reload-configuration"
            className="border-border mt-2 border-t pt-2"
          >
            <p className="text-xs font-medium">
              {t("workbench.chat.commandResponses.reloadConfiguration.title")}
            </p>
            <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
              {(
                [
                  [
                    t("workbench.chat.commandResponses.reloadConfiguration.extensions"),
                    reloadConfiguration.extensions,
                    true,
                  ],
                  [
                    t("workbench.chat.commandResponses.reloadConfiguration.skills"),
                    reloadConfiguration.skills,
                    false,
                  ],
                  [
                    t("workbench.chat.commandResponses.reloadConfiguration.prompts"),
                    reloadConfiguration.prompts.map((prompt) => `/${prompt}`),
                    false,
                  ],
                  [
                    t("workbench.chat.commandResponses.reloadConfiguration.contextFiles"),
                    reloadConfiguration.contextFiles,
                    true,
                  ],
                ] as const
              ).map(([label, items, paths]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="mt-0.5 break-all font-mono">
                    {items.length
                      ? paths
                        ? items.map((item, index) => (
                            <span key={`${item}-${index}`}>
                              {index ? ", " : null}
                              <code className="rounded bg-muted px-1 py-0.5 text-[0.875em]">
                                {item}
                              </code>
                            </span>
                          ))
                        : items.join(", ")
                      : t("workbench.chat.commandResponses.reloadConfiguration.none")}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
        <CommandResponseIdentity
          response={response}
          fieldLabels={argumentFieldLabels}
          className={cn(
            "mt-2 w-full border-t pt-2",
            failed ? "border-destructive/15" : "border-border",
          )}
        />
      </div>
    </div>
  );
}
