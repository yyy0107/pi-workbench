"use client";

import { useState } from "react";
import { ScanTextIcon } from "lucide-react";

import type { DataRendererComponent } from "@workbench/extension-sdk";
import { field, mono, Progress } from "@workbench/shell/ui";
import { ToolCall } from "@workbench/shell/elements";
import { useI18n } from "@workbench/shell/i18n";
import type {
  AttachmentRecognitionFailurePhase,
  AttachmentRecognitionResultSource,
} from "@workbench/attachment-understanding-contracts/state-machine";

import {
  imageRecognitionLiveRegion,
  parseAttachmentRecognitionPresentation,
  type ImageRecognitionErrorKind,
  type ImageRecognitionMethod,
  type ImageRecognitionResultFormat,
  type ImageRecognitionPresentationResult,
  type ImageRecognitionPresentationJob,
  type ImageRecognitionSkipKind,
  type ImageRecognitionStage,
} from "./image-recognition-presentation";

function resultReferenceLabel(
  result: Pick<ImageRecognitionPresentationResult, "referenceKind" | "sequence">,
  t: ReturnType<typeof useI18n>["t"],
): string {
  switch (result.referenceKind) {
    case "image":
      return t("extensions.imageUnderstanding.recognition.results.image", {
        index: result.sequence,
      });
    case "pdf":
      return t("extensions.imageUnderstanding.recognition.results.pdf", {
        index: result.sequence,
      });
    case "attachment":
      return t("extensions.imageUnderstanding.recognition.results.attachment", {
        index: result.sequence,
      });
  }
}

function methodLabel(method: ImageRecognitionMethod, t: ReturnType<typeof useI18n>["t"]): string {
  switch (method) {
    case "ocr":
      return t("extensions.imageUnderstanding.recognition.methods.ocr");
    case "multimodal":
      return t("extensions.imageUnderstanding.recognition.methods.multimodal");
    case "native":
      return t("extensions.imageUnderstanding.recognition.methods.native");
  }
}

function resultFormatLabel(
  format: ImageRecognitionResultFormat,
  t: ReturnType<typeof useI18n>["t"],
): string {
  return format === "markdown"
    ? t("extensions.imageUnderstanding.recognition.results.formats.markdown")
    : t("extensions.imageUnderstanding.recognition.results.formats.text");
}

function stageLabel(stage: ImageRecognitionStage, t: ReturnType<typeof useI18n>["t"]): string {
  switch (stage) {
    case "routing":
      return t("extensions.imageUnderstanding.recognition.stages.routing");
    case "submitting":
      return t("extensions.imageUnderstanding.recognition.stages.submitting");
    case "polling":
      return t("extensions.imageUnderstanding.recognition.stages.polling");
    case "recognizing":
      return t("extensions.imageUnderstanding.recognition.stages.recognizing");
    case "normalizing":
      return t("extensions.imageUnderstanding.recognition.stages.normalizing");
    case "fallback":
      return t("extensions.imageUnderstanding.recognition.stages.fallback");
  }
}

function failurePhaseLabel(
  phase: AttachmentRecognitionFailurePhase,
  t: ReturnType<typeof useI18n>["t"],
): string {
  switch (phase) {
    case "configuration":
      return t("extensions.imageUnderstanding.recognition.diagnostics.phases.configuration");
    case "routing":
      return t("extensions.imageUnderstanding.recognition.diagnostics.phases.routing");
    case "submission":
      return t("extensions.imageUnderstanding.recognition.diagnostics.phases.submission");
    case "polling":
      return t("extensions.imageUnderstanding.recognition.diagnostics.phases.polling");
    case "result-download":
      return t("extensions.imageUnderstanding.recognition.diagnostics.phases.resultDownload");
    case "result-parsing":
      return t("extensions.imageUnderstanding.recognition.diagnostics.phases.resultParsing");
    case "normalizing":
      return t("extensions.imageUnderstanding.recognition.diagnostics.phases.normalizing");
  }
}

function resultSourceLabel(
  source: AttachmentRecognitionResultSource,
  t: ReturnType<typeof useI18n>["t"],
): string {
  return source === "jsonl"
    ? t("extensions.imageUnderstanding.recognition.diagnostics.sources.jsonl")
    : t("extensions.imageUnderstanding.recognition.diagnostics.sources.markdown");
}

function errorLabel(kind: ImageRecognitionErrorKind, t: ReturnType<typeof useI18n>["t"]): string {
  switch (kind) {
    case "storage":
      return t("extensions.imageUnderstanding.recognition.errors.storage");
    case "authentication":
      return t("extensions.imageUnderstanding.recognition.errors.authentication");
    case "configuration":
      return t("extensions.imageUnderstanding.recognition.errors.configuration");
    case "rateLimited":
      return t("extensions.imageUnderstanding.recognition.errors.rateLimited");
    case "timeout":
      return t("extensions.imageUnderstanding.recognition.errors.timeout");
    case "network":
      return t("extensions.imageUnderstanding.recognition.errors.network");
    case "serviceUnavailable":
      return t("extensions.imageUnderstanding.recognition.errors.serviceUnavailable");
    case "unsupportedImage":
      return t("extensions.imageUnderstanding.recognition.errors.unsupportedImage");
    case "invalidResponse":
      return t("extensions.imageUnderstanding.recognition.errors.invalidResponse");
    case "generic":
      return t("extensions.imageUnderstanding.recognition.errors.generic");
  }
}

function skipLabel(kind: ImageRecognitionSkipKind, t: ReturnType<typeof useI18n>["t"]): string {
  switch (kind) {
    case "native":
      return t("extensions.imageUnderstanding.recognition.skipped.native");
    case "disabled":
      return t("extensions.imageUnderstanding.recognition.skipped.disabled");
    case "notNeeded":
      return t("extensions.imageUnderstanding.recognition.skipped.notNeeded");
    case "generic":
      return t("extensions.imageUnderstanding.recognition.skipped.generic");
  }
}

export const AttachmentRecognitionRenderer: DataRendererComponent = ({ block }) => {
  const { locale, number, t } = useI18n();
  const state = parseAttachmentRecognitionPresentation(block.data);
  const [open, setOpen] = useState(
    () => state?.status === "pending" || state?.status === "running",
  );
  if (!state || (state.status === "skipped" && state.method === "native")) return null;

  const failed = state.status === "failed";
  const running = state.status === "pending" || state.status === "running";
  const liveRegion = imageRecognitionLiveRegion(state.status);
  const title = (() => {
    switch (state.status) {
      case "pending":
        return t("extensions.imageUnderstanding.recognition.status.pending");
      case "running":
        return t("extensions.imageUnderstanding.recognition.status.running");
      case "succeeded":
        return t("extensions.imageUnderstanding.recognition.status.succeeded");
      case "failed":
        return t("extensions.imageUnderstanding.recognition.status.failed");
      case "cancelled":
        return t("extensions.imageUnderstanding.recognition.status.cancelled");
      case "skipped":
        return t("extensions.imageUnderstanding.recognition.status.skipped");
    }
  })();
  const detail = failed
    ? errorLabel(state.errorKind ?? "generic", t)
    : state.status === "skipped"
      ? skipLabel(state.skipKind ?? "generic", t)
      : running && state.stage
        ? stageLabel(state.stage, t)
        : undefined;
  const attachmentProgress = t("extensions.imageUnderstanding.recognition.progress", {
    completed: state.completedCount,
    total: state.attachmentCount,
  });
  const jobStatus = (job: ImageRecognitionPresentationJob) =>
    t(`extensions.imageUnderstanding.recognition.jobs.status.${job.status}`);
  const jobSummary = (job: ImageRecognitionPresentationJob) =>
    [
      resultReferenceLabel(job, t),
      jobStatus(job),
      job.progress === undefined ? undefined : number(job.progress, { style: "percent" }),
    ]
      .filter(Boolean)
      .join(" · ");
  const activeJob = running
    ? state.jobs.find(
        (job) =>
          job.status !== "succeeded" && job.status !== "cancelled" && job.status !== "queued",
      )
    : undefined;
  const query = [
    activeJob ? jobSummary(activeJob) : (detail ?? methodLabel(state.method, t)),
    running ? attachmentProgress : undefined,
    state.providerId
      ? t("extensions.imageUnderstanding.recognition.provider", {
          providerId: state.providerId,
        })
      : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  const expandable = running || failed || state.jobs.length > 0 || state.results.length > 0;
  const diagnosticRows = failed
    ? [
        {
          label: t("extensions.imageUnderstanding.recognition.diagnostics.errorCode"),
          value: state.errorCode,
        },
        {
          label: t("extensions.imageUnderstanding.recognition.diagnostics.phase"),
          value: state.diagnostic ? failurePhaseLabel(state.diagnostic.phase, t) : undefined,
        },
        {
          label: t("extensions.imageUnderstanding.recognition.diagnostics.reason"),
          value: state.diagnostic?.reason,
        },
        {
          label: t("extensions.imageUnderstanding.recognition.diagnostics.httpStatus"),
          value: state.diagnostic?.httpStatus?.toString(),
        },
        {
          label: t("extensions.imageUnderstanding.recognition.diagnostics.providerCode"),
          value: state.diagnostic?.providerCode,
        },
        {
          label: t("extensions.imageUnderstanding.recognition.diagnostics.resultSource"),
          value: state.diagnostic?.resultSource
            ? resultSourceLabel(state.diagnostic.resultSource, t)
            : undefined,
        },
        {
          label: t("extensions.imageUnderstanding.recognition.diagnostics.method"),
          value: methodLabel(state.method, t),
        },
        {
          label: t("extensions.imageUnderstanding.recognition.diagnostics.provider"),
          value: state.providerId,
        },
      ].filter((row): row is { label: string; value: string } => Boolean(row.value))
    : [];

  return (
    <div data-slot="attachment-recognition-timeline-step" className="w-full">
      <span
        role={liveRegion.role}
        aria-live={liveRegion.live}
        aria-atomic="true"
        className="sr-only"
      >
        {title}. {query}
      </span>
      <ToolCall
        label={title}
        activeLabel={title}
        query={query}
        request=""
        result=""
        requestLabel=""
        resultLabel=""
        icon={ScanTextIcon}
        running={running}
        failed={failed}
        failedLabel={title}
        showCompletionIcon={state.status === "succeeded"}
        expandable={expandable}
        open={expandable && open}
        onOpenChange={setOpen}
      >
        {running || state.jobs.length > 0 ? (
          <div data-slot="attachment-recognition-progress" className="mb-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{t("extensions.imageUnderstanding.recognition.jobs.title")}</span>
              <span>{attachmentProgress}</span>
            </div>
            {state.jobs.length > 0 ? (
              <div className="divide-y divide-border rounded-lg border border-border bg-muted/30 px-3">
                {state.jobs.map((job) => (
                  <section
                    key={job.attachmentId}
                    aria-label={resultReferenceLabel(job, t)}
                    className="space-y-2 py-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-foreground">{resultReferenceLabel(job, t)}</span>
                      <span
                        className={
                          job.status === "failed" ? "text-destructive" : "text-muted-foreground"
                        }
                      >
                        {jobStatus(job)}
                        {job.progress !== undefined
                          ? ` · ${number(job.progress, { style: "percent" })}`
                          : ""}
                      </span>
                    </div>
                    {job.progress !== undefined ? (
                      <Progress
                        locale={locale}
                        value={job.progress * 100}
                        aria-label={jobSummary(job)}
                        getAriaValueText={() => jobSummary(job)}
                      />
                    ) : null}
                    <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground tabular-nums">
                      <span>
                        {job.completedPages !== undefined && job.totalPages !== undefined
                          ? t("extensions.imageUnderstanding.recognition.jobs.pages", {
                              completed: job.completedPages,
                              total: job.totalPages,
                            })
                          : job.status === "pending"
                            ? t("extensions.imageUnderstanding.recognition.jobs.waitingInQueue")
                            : job.status === "running"
                              ? t(
                                  "extensions.imageUnderstanding.recognition.jobs.waitingForProgress",
                                )
                              : null}
                      </span>
                      {job.pollCount > 0 ? (
                        <span>
                          {t("extensions.imageUnderstanding.recognition.jobs.polls", {
                            count: job.pollCount,
                          })}
                        </span>
                      ) : null}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className="space-y-2 text-xs text-muted-foreground">
                <p>{detail}</p>
                <Progress
                  locale={locale}
                  value={state.method === "ocr" ? null : state.progress * 100}
                  aria-label={t("extensions.imageUnderstanding.recognition.progressLabel")}
                  getAriaValueText={() => detail ?? title}
                />
              </div>
            )}
          </div>
        ) : null}
        {failed ? (
          <div data-slot="attachment-recognition-diagnostics">
            <p className={`${mono} text-foreground/35 mb-1.5`}>
              {t("extensions.imageUnderstanding.recognition.diagnostics.title")}
            </p>
            <dl className={`${field} divide-foreground/10 divide-y rounded-2xl px-3.5`}>
              {diagnosticRows.map((row) => (
                <div key={row.label} className="flex items-start justify-between gap-4 py-2.5">
                  <dt className="text-foreground/45 text-xs">{row.label}</dt>
                  <dd className="text-foreground/80 break-all text-right font-mono text-xs">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="text-foreground/40 mt-2 text-xs">
              {t("extensions.imageUnderstanding.recognition.diagnostics.sanitizedNote")}
            </p>
          </div>
        ) : state.results.length > 0 ? (
          <div data-slot="attachment-recognition-results">
            <p className={`${mono} text-foreground/35 mb-1.5`}>
              {t("extensions.imageUnderstanding.recognition.results.title")}
            </p>
            <div className={`${field} max-h-96 overflow-auto rounded-2xl`}>
              {state.results.map((result) => (
                <section
                  key={result.attachmentId}
                  aria-label={resultReferenceLabel(result, t)}
                  className="px-3.5 py-3 [&+&]:border-t [&+&]:border-foreground/10"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span className={`${mono} text-foreground/55`}>
                      {resultReferenceLabel(result, t)}
                    </span>
                    <span className="bg-foreground/[0.06] text-foreground/45 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase">
                      {resultFormatLabel(result.format, t)}
                    </span>
                  </div>
                  <pre className="text-foreground/80 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                    {result.text}
                  </pre>
                  {result.truncated ? (
                    <p className="text-foreground/45 mt-2 text-xs italic">
                      {t("extensions.imageUnderstanding.recognition.results.truncated")}
                    </p>
                  ) : null}
                </section>
              ))}
            </div>
          </div>
        ) : null}
      </ToolCall>
    </div>
  );
};
