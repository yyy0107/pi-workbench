"use client";

import type { DataMessagePartComponent } from "@assistant-ui/react";
import {
  BanIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  CircleDashedIcon,
  CircleMinusIcon,
  LoaderCircleIcon,
} from "lucide-react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

import {
  imageRecognitionLiveRegion,
  parseImageRecognitionPresentation,
  type ImageRecognitionErrorKind,
  type ImageRecognitionMethod,
  type ImageRecognitionPresentationState,
  type ImageRecognitionSkipKind,
  type ImageRecognitionStage,
} from "./image-recognition-presentation";

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

function RecognitionProgress({ state }: { state: ImageRecognitionPresentationState }) {
  const { t, number } = useI18n();
  const percent = Math.round(state.progress * 100);

  return (
    <div className="mt-2">
      <div className="text-muted-foreground flex items-center justify-between gap-3 text-xs">
        <span>
          {t("extensions.imageUnderstanding.recognition.progress", {
            completed: state.completedCount,
            total: state.imageCount,
          })}
        </span>
        <span aria-hidden="true">{number(state.progress, { style: "percent" })}</span>
      </div>
      <div
        role="progressbar"
        aria-label={t("extensions.imageUnderstanding.recognition.progressLabel")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="bg-muted mt-1.5 h-1.5 overflow-hidden rounded-full"
      >
        <div
          className="bg-primary h-full rounded-full transition-[width] motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export const ImageRecognitionRenderer: DataMessagePartComponent = ({ data }) => {
  const { t } = useI18n();
  const state = parseImageRecognitionPresentation(data);
  if (!state || (state.status === "skipped" && state.method === "native")) return null;

  const failed = state.status === "failed";
  const running = state.status === "running";
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
  const Icon = (() => {
    switch (state.status) {
      case "pending":
        return CircleDashedIcon;
      case "running":
        return LoaderCircleIcon;
      case "succeeded":
        return CheckCircle2Icon;
      case "failed":
        return CircleAlertIcon;
      case "cancelled":
        return BanIcon;
      case "skipped":
        return CircleMinusIcon;
    }
  })();

  return (
    <div
      role={liveRegion.role}
      aria-live={liveRegion.live}
      aria-atomic="true"
      className={cn(
        "my-2 rounded-lg border px-3 py-2 text-sm",
        failed ? "border-destructive/30 bg-destructive/5" : "bg-muted/30",
      )}
    >
      <div className="flex items-start gap-2">
        <Icon
          aria-hidden="true"
          className={cn(
            "mt-0.5 size-4 shrink-0",
            running && "animate-spin motion-reduce:animate-none",
            failed && "text-destructive",
            state.status === "succeeded" && "text-emerald-600 dark:text-emerald-400",
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{title}</p>
          <p className={cn("text-muted-foreground mt-0.5 text-xs", failed && "text-destructive")}>
            {detail ?? methodLabel(state.method, t)}
          </p>
          {state.providerId ? (
            <p className="text-muted-foreground mt-0.5 truncate text-xs">
              {t("extensions.imageUnderstanding.recognition.provider", {
                providerId: state.providerId,
              })}
            </p>
          ) : null}
          {(state.status === "pending" || running) && state.imageCount > 0 ? (
            <RecognitionProgress state={state} />
          ) : null}
        </div>
      </div>
    </div>
  );
};
