import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

import {
  PI_CANCEL_INTENT_CUSTOM_TYPE,
  PI_MESSAGE_TERMINATION_DIAGNOSTIC_TYPE,
  type PiMessageTerminationKind,
} from "@workbench/agent-runtime-pi-shared/messages";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function diagnosticText(diagnostic: {
  type: string;
  error?: { name?: string; message: string; code?: string | number };
  details?: Record<string, unknown>;
}): string {
  const error = isRecord(diagnostic.error) ? diagnostic.error : undefined;
  const details = isRecord(diagnostic.details) ? diagnostic.details : undefined;

  return [
    optionalString(diagnostic.type),
    optionalString(error?.name),
    optionalString(error?.message),
    typeof error?.code === "string" || typeof error?.code === "number"
      ? String(error.code)
      : undefined,
    typeof details?.status === "number" ? String(details.status) : undefined,
    optionalString(details?.statusText),
    optionalString(details?.errorCode),
  ]
    .filter((value) => Boolean(value))
    .join(" ");
}

export const messageTerminationExtension: ExtensionFactory = (pi) => {
  let runStartedAt: number | undefined;
  pi.on("agent_start", () => {
    runStartedAt = Date.now();
  });

  pi.on("message_end", (event, context) => {
    if (event.message.role !== "assistant") return;

    const message = event.message;
    const stopReason = message.stopReason || "unknown";
    let kind: PiMessageTerminationKind = "completed";
    let source: "workbench" | undefined;

    if (stopReason === "length") {
      kind = "length";
    } else if (stopReason === "aborted" || (stopReason === "error" && context.signal?.aborted)) {
      const entries = context.sessionManager.getBranch();
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (entry?.type !== "custom" || entry.customType !== PI_CANCEL_INTENT_CUSTOM_TYPE) {
          continue;
        }
        const data = isRecord(entry.data) ? entry.data : undefined;
        const requestedAt = data?.requestedAt;
        if (
          typeof requestedAt === "number" &&
          Number.isFinite(requestedAt) &&
          // Abort failures can create a new terminal message after the stop request.
          requestedAt >= (runStartedAt ?? message.timestamp)
        ) {
          kind = "cancelled";
          source = "workbench";
        }
        break;
      }
      if (kind !== "cancelled") kind = "aborted";
    } else if (stopReason === "error") {
      const diagnostics = message.diagnostics ?? [];
      const evidence = [
        message.errorMessage,
        message.rawStopReason,
        ...diagnostics.map(diagnosticText),
      ]
        .filter((value) => Boolean(value))
        .join(" ");
      const hasTransportDiagnostic = diagnostics.some(
        (diagnostic) => diagnostic.type === "provider_transport_failure",
      );
      const hasResponseDiagnostic = diagnostics.some(
        (diagnostic) =>
          diagnostic.type.endsWith("_response_failure") ||
          (isRecord(diagnostic.details) && typeof diagnostic.details.status === "number"),
      );
      const looksLikeNetworkFailure =
        /\b(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR_[A-Z_]+)\b|fetch failed|network|socket|connection (?:closed|reset|refused)|timed? out|dns/i.test(
          evidence,
        );
      const looksLikeApiFailure =
        /\b(?:HTTP|status)\s*[=:]?\s*[45]\d\d\b|\bAPI (?:error|request)\b|rate.?limit|unauthorized|forbidden|authentication|invalid api key/i.test(
          evidence,
        );

      kind =
        hasTransportDiagnostic || looksLikeNetworkFailure
          ? "network-error"
          : hasResponseDiagnostic || looksLikeApiFailure
            ? "api-error"
            : "provider-error";
    }

    const diagnostics = (message.diagnostics ?? []).filter(
      (diagnostic) => diagnostic.type !== PI_MESSAGE_TERMINATION_DIAGNOSTIC_TYPE,
    );

    return {
      message: {
        ...message,
        diagnostics: [
          ...diagnostics,
          {
            type: PI_MESSAGE_TERMINATION_DIAGNOSTIC_TYPE,
            timestamp: Date.now(),
            details: {
              schemaVersion: 1,
              kind,
              stopReason,
              ...(message.rawStopReason ? { rawStopReason: message.rawStopReason } : {}),
              ...(message.errorMessage ? { errorMessage: message.errorMessage } : {}),
              ...(source ? { source } : {}),
            },
          },
        ],
      },
    };
  });
};
