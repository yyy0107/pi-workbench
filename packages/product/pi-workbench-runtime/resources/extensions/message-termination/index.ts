import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import {
  PI_CANCEL_INTENT_CUSTOM_TYPE,
  PI_MESSAGE_TERMINATION_DIAGNOSTIC_TYPE,
  type PiMessageTerminationKind,
} from "@workbench/pi-runtime-adapters/messages";
import { isRecord, diagnosticText } from "../../../src/message-termination/index";
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

export default messageTerminationExtension;
