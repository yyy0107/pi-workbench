import type {
  WorkbenchComposerCommandFailureReason,
  WorkbenchComposerCommandSubmission,
} from "@workbench/contracts/composer/request";

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).trim().toLowerCase();
}

function errorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as { readonly status?: unknown; readonly statusCode?: unknown };
  if (typeof candidate.status === "number" && Number.isFinite(candidate.status)) {
    return candidate.status;
  }
  return typeof candidate.statusCode === "number" && Number.isFinite(candidate.statusCode)
    ? candidate.statusCode
    : undefined;
}

/** Redacts Pi/provider failures to stable reasons safe for browser-visible history. */
export function composerCommandFailureReason(
  command: Pick<WorkbenchComposerCommandSubmission, "commandId">,
  error: unknown,
): WorkbenchComposerCommandFailureReason {
  const message = errorMessage(error);
  const status = errorStatus(error);

  if (error instanceof Error && error.name === "AbortError") return "cancelled";
  if (/\b(?:cancelled|canceled|aborted)\b/u.test(message)) return "cancelled";

  if (command.commandId === "compact") {
    if (message.includes("nothing to compact") || message.includes("session too small")) {
      return "context-too-small";
    }
    if (message.includes("already compacted")) return "already-compacted";
    if (message.includes("session may need migration") || message.includes("has no uuid")) {
      return "session-data-invalid";
    }
    if (message.includes("no model selected") || message.includes("model not available")) {
      return "model-unavailable";
    }
  }

  if (
    /\b(?:insufficient_quota|quota exceeded|out of budget|billing|usage limit)\b/u.test(message)
  ) {
    return "quota-exhausted";
  }
  if (
    status === 401 ||
    status === 403 ||
    /\b(?:authentication|unauthorized|forbidden|api key|credentials?|login)\b/u.test(message)
  ) {
    return "authentication-failed";
  }
  if (status === 429 || /\b(?:rate.?limit|too many requests|throttl)\w*\b/u.test(message)) {
    return "rate-limited";
  }
  if (/\b(?:timed? out|timeout)\b/u.test(message)) return "timeout";
  if (
    /\b(?:network error|connection (?:error|refused|lost)|fetch failed|enotfound|eai_again|socket hang up|upstream connect)\b/u.test(
      message,
    )
  ) {
    return "network-error";
  }
  if (
    (status !== undefined && status >= 500) ||
    /\b(?:provider unavailable|service unavailable|provider returned error|overloaded)\b/u.test(
      message,
    )
  ) {
    return "provider-unavailable";
  }
  if (command.commandId === "compact" && /\b(?:summary|summarization) failed\b/u.test(message)) {
    return "summary-generation-failed";
  }
  if (command.commandId === "reload") return "reload-failed";
  return "unknown";
}
