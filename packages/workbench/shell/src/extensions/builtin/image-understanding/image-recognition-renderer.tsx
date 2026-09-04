"use client";

import { useState } from "react";
import { ScanTextIcon } from "lucide-react";

import type { DataRendererComponent } from "@workbench/extension-sdk";
import { field, mono } from "@workbench/shell/ui";
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
  type ImageRecognitionSkipKind,
  type ImageRecognitionStage,
} from "./image-recognition-presentation";

function resultReferenceLabel(
  result: ImageRecognitionPresentationResult,
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
  const { number, t } = useI18n();
  const [open, setOpen] = useState(false);
  const state = parseAttachmentRecognitionPresentation(block.data);
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
  const progress = running
    ? `${t("extensions.imageUnderstanding.recognition.progress", {
        completed: state.completedCount,
        total: state.attachmentCount,
      })} · ${number(state.progress, { style: "percent" })}`
    : undefined;
  const query = [
    detail ?? methodLabel(state.method, t),
    state.providerId
      ? t("extensions.imageUnderstanding.recognition.provider", {
          providerId: state.providerId,
        })
      : undefined,
    progress,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  const expandable = failed || state.results.length > 0;
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
        iconClassName="size-4"
        running={running}
        failed={failed}
        failedLabel={title}
        showCompletionIcon={state.status === "succeeded"}
        expandable={expandable}
        open={expandable && open}
        onOpenChange={setOpen}
      >
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
        ) : expandable ? (
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
