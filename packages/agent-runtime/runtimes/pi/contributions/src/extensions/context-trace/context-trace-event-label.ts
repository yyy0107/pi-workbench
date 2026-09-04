import type { SessionContextTraceKind } from "@workbench/agent-runtime-pi-protocol/rpc";

import type { PiTranslate } from "../../i18n";

export function contextTraceEventLabel(t: PiTranslate, kind: SessionContextTraceKind): string {
  switch (kind) {
    case "round-start":
      return t("extensions.contextTrace.events.roundStart");
    case "prompt-composition":
      return t("extensions.contextTrace.events.promptComposition");
    case "run-start":
      return t("extensions.contextTrace.events.runStart");
    case "turn-start":
      return t("extensions.contextTrace.events.turnStart");
    case "context-snapshot":
      return t("extensions.contextTrace.events.contextSnapshot");
    case "provider-request":
      return t("extensions.contextTrace.events.providerRequest");
    case "provider-response":
      return t("extensions.contextTrace.events.providerResponse");
    case "model-output":
      return t("extensions.contextTrace.events.modelOutput");
    case "tool-execution-start":
      return t("extensions.contextTrace.events.toolExecutionStart");
    case "tool-execution-end":
      return t("extensions.contextTrace.events.toolExecutionEnd");
    case "turn-end":
      return t("extensions.contextTrace.events.turnEnd");
    case "run-end":
      return t("extensions.contextTrace.events.runEnd");
    case "retry":
      return t("extensions.contextTrace.events.retry");
    case "compaction":
      return t("extensions.contextTrace.events.compaction");
    case "round-settled":
      return t("extensions.contextTrace.events.roundSettled");
  }
}
