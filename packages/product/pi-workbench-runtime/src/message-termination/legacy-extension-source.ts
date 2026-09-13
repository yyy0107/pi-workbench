/**
 * UTF-8 source for the legacy Workbench-managed Pi extension.
 *
 * Keep this byte-for-byte stable: migration deletes an installed extension only
 * when its contents exactly match this historical source, including its final
 * newline.
 */
export const LEGACY_WORKBENCH_MESSAGE_TERMINATION_EXTENSION_SOURCE = String.raw`// @pi-workbench-managed-extension workbench.message-termination v1

/** @param {import("@earendil-works/pi-coding-agent").ExtensionAPI} pi */
export default function workbenchMessageTerminationExtension(pi) {
  const diagnosticType = "workbench.message-termination.v1";
  const cancelIntentType = "workbench.cancel-intent.v1";

  const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  const optionalString = (value) =>
    typeof value === "string" && value.length > 0 ? value : undefined;
  const diagnosticText = (diagnostic) => {
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
  };

  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;

    const message = event.message;
    if (message.diagnostics?.some((diagnostic) => diagnostic.type === diagnosticType)) return;

    const stopReason = message.stopReason || "unknown";
    let kind = "completed";
    let source;

    if (stopReason === "length") {
      kind = "length";
    } else if (stopReason === "aborted") {
      const entries = ctx.sessionManager.getBranch();
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (entry?.type !== "custom" || entry.customType !== cancelIntentType) continue;
        const data = isRecord(entry.data) ? entry.data : undefined;
        const requestedAt = data?.requestedAt;
        if (
          typeof requestedAt === "number" &&
          Number.isFinite(requestedAt) &&
          requestedAt >= message.timestamp
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

    return {
      message: {
        ...message,
        diagnostics: [
          ...(message.diagnostics ?? []),
          {
            type: diagnosticType,
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
}
`;
