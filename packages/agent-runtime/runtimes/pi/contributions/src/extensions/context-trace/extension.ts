import { ScanSearchIcon } from "lucide-react";

import {
  createLazyWorkspaceSurface,
  defineExtension,
  type WorkspaceSurfaceDefinition,
} from "@workbench/extension-sdk";
import {
  parsePiContextTraceData,
  piContextTracePromptInjections,
  WORKBENCH_PI_CONTEXT_TRACE_DATA_NAME,
} from "@workbench/agent-runtime-pi-client/context-trace";

import { definePiMessage } from "../../i18n";

import { ContextTraceMessagePart } from "./context-trace-message-part";
import { ContextTraceMenuItem } from "./context-trace-menu-item";
import { ContextTraceTrigger } from "./context-trace-trigger";
import {
  CONTEXT_TRACE_SURFACE_KIND,
  CONTEXT_TRACE_SURFACE_TITLE,
  type ContextTraceSurfaceParams,
} from "./context-trace-workspace";

const ContextTraceSurface = createLazyWorkspaceSurface(async () => {
  const module = await import("./context-trace-surface");
  return { default: module.ContextTraceSurface };
});

export const contextTraceSurfaceDefinition = {
  kind: CONTEXT_TRACE_SURFACE_KIND,
  icon: ScanSearchIcon,
  cachePolicy: "unmount",
  persistence: "session",
  defaultPlacement: "primary",
  allowDuplicateResources: false,
  getResourceKey: (params) => `context-trace:${encodeURIComponent(params.sessionId)}`,
  getDefaultScope: (params, context) => ({
    type: context.threadId ? "thread" : "application",
    key: context.threadId ?? params.sessionId,
  }),
  render: ContextTraceSurface,
  menuItem: ContextTraceMenuItem,
} satisfies WorkspaceSurfaceDefinition<ContextTraceSurfaceParams>;

export const contextTraceExtension = defineExtension({
  id: "workbench.context-trace",
  name: "Context Trace",
  version: "1.0.0",
  setup(context) {
    const dataRenderer = context.renderers.data.register(
      WORKBENCH_PI_CONTEXT_TRACE_DATA_NAME,
      ContextTraceMessagePart,
    );
    const dataPresentation = context.renderers.dataPresentations.register(
      WORKBENCH_PI_CONTEXT_TRACE_DATA_NAME,
      {
        display: "timeline",
        group: {
          getKey: (part) => parsePiContextTraceData(part.data)?.event.traceId,
          label: definePiMessage("extensions.contextTrace.messagePart.contextComposed"),
          activeLabel: definePiMessage("extensions.contextTrace.messagePart.composingContext"),
          icon: ScanSearchIcon,
        },
        isVisible: (part) => {
          const parsed = parsePiContextTraceData(part.data);
          return (
            parsed?.event.kind === "prompt-composition" &&
            parsed.promptInjection !== undefined &&
            piContextTracePromptInjections(parsed.event).includes(parsed.promptInjection)
          );
        },
      },
    );
    const surface = context.workspace.register(contextTraceSurfaceDefinition);
    const opener = context.openers.register({
      id: "workbench.context-trace.open",
      canOpen: (request) => (request.resource.scheme === "context-trace" ? 100 : 0),
      open: (request, operations) =>
        operations.surfaces.reveal({
          kind: CONTEXT_TRACE_SURFACE_KIND,
          title: CONTEXT_TRACE_SURFACE_TITLE,
          params: { sessionId: request.resource.path } satisfies ContextTraceSurfaceParams,
          context: request.context,
          scope:
            request.scope ??
            ({
              type: request.context.threadId ? "thread" : "application",
              key: request.context.threadId ?? request.context.applicationId,
            } as const),
          policy: request.policy ?? "reveal",
          status: "loading",
        }),
    });
    const trigger = context.slots.register("header.left", {
      id: "workbench.context-trace.header-left",
      order: 80,
      component: ContextTraceTrigger,
    });
    return [dataRenderer, dataPresentation, surface, opener, trigger];
  },
});
