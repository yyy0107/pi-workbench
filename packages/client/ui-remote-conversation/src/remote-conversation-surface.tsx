"use client";

import { RuntimeProvider, SessionProvider } from "@workbench/agent-runtime-client";
import { WorkbenchAgentRuntimeEnvironmentProvider } from "@workbench/agent-runtime-client/context";
import type { DataRendererComponent, MessageRendererProps } from "@workbench/extension-sdk";
import { defineExtension } from "@workbench/extension-sdk";
import { ExtensionProvider } from "@workbench/extension-host/installation";
import { useI18n } from "@workbench/i18n";
import type { RemoteConversationItemV1 } from "@workbench/remote-control-contracts/protocol";
import { WorkbenchSettingsProvider } from "@workbench/settings-runtime";
import { createPanelStore } from "@workbench/shell-context/panel-store";
import { Button } from "@workbench/ui/button";
import { ConversationList } from "@workbench/ui-conversation-messages/list";
import { WorkbenchMessagePresentation } from "@workbench/ui-conversation-nodes/message-presentation";
import { ToolCall } from "@workbench/ui-tool/tool-call";
import { ChevronUpIcon, LayersIcon, LoaderCircleIcon, ScanSearchIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { RemoteConversationAgentRuntime } from "../lib/remote-agent-runtime";
import { remoteConversationNodes } from "../lib/remote-conversation-model";
import { defineRemoteConversationMessage, remoteConversationTranslationBundle } from "./i18n";

const REMOTE_PRESENTATION_SETTINGS = Object.freeze({
  load: async () => ({}),
  update: async () => undefined,
});
const REMOTE_AGENT_COMMANDS = Object.freeze([]);
const CONTEXT_DATA_NAME = "workbench.pi-context-trace-event";

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function contextData(value: unknown) {
  const root = record(value);
  const event = record(root?.event);
  if (root?.version !== 1 || event?.kind !== "prompt-composition") return undefined;
  const injection = root.promptInjection;
  if (injection !== "system-prompt" && injection !== "tools" && injection !== "extensions") {
    return undefined;
  }
  const resources = record(event.promptResources);
  const tools = record(resources?.tools);
  const extensions = Array.isArray(resources?.extensions)
    ? resources.extensions
        .map(record)
        .filter((entry): entry is Readonly<Record<string, unknown>> => entry !== undefined)
        .filter((entry) => entry.hidden !== true)
        .flatMap((entry) => (typeof entry.name === "string" ? [entry.name] : []))
    : [];
  return {
    traceId: typeof event.traceId === "string" ? event.traceId : "context",
    injection,
    model: record(event.model),
    systemPromptCharacters:
      typeof resources?.systemPromptCharacters === "number"
        ? resources.systemPromptCharacters
        : undefined,
    tools: stringArray(tools?.active),
    extensions,
  } as const;
}

const RemoteContextTracePart: DataRendererComponent = ({ block }) => {
  const { number, t } = useI18n(remoteConversationTranslationBundle);
  const context = contextData(block.data);
  const [open, setOpen] = useState(false);
  if (!context) return null;
  const values =
    context.injection === "tools"
      ? context.tools
      : context.injection === "extensions"
        ? context.extensions
        : context.systemPromptCharacters === undefined
          ? []
          : [number(context.systemPromptCharacters)];
  const label =
    context.injection === "system-prompt"
      ? t("remoteConversation.systemPromptInjected")
      : t("remoteConversation.contextComposed");
  const query =
    context.injection === "tools"
      ? t("remoteConversation.toolsInjected", { count: values.length })
      : context.injection === "extensions"
        ? t("remoteConversation.extensionsLoaded", { count: values.length })
        : context.model &&
            typeof context.model.provider === "string" &&
            typeof context.model.model === "string"
          ? `${context.model.provider}/${context.model.model}`
          : "";
  return (
    <ToolCall
      activeLabel={label}
      expandable={values.length > 0}
      icon={ScanSearchIcon}
      label={label}
      onOpenChange={setOpen}
      open={values.length > 0 && open}
      query={query}
      request=""
      requestLabel=""
      result={values.join("\n")}
      resultLabel={t("remoteConversation.contextDetails")}
      running={false}
      showCompletionIcon={false}
    />
  );
};

function RemoteWorkbenchMessagePresentation({ node }: MessageRendererProps) {
  return <WorkbenchMessagePresentation node={node} showFileChanges={false} />;
}

const remoteConversationPresentationExtension = defineExtension({
  id: "workbench.remote-conversation-presentation",
  name: "Remote Conversation Presentation",
  version: "1.0.0",
  setup(context) {
    const message = context.renderers.message.register({
      id: "workbench.remote-message-presentation",
      component: RemoteWorkbenchMessagePresentation,
    });
    const renderer = context.renderers.data.register(CONTEXT_DATA_NAME, RemoteContextTracePart);
    const presentation = context.renderers.dataPresentations.register(CONTEXT_DATA_NAME, {
      display: "timeline",
      isVisible: (block) => contextData(block.data) !== undefined,
      group: {
        getKey: (block) => contextData(block.data)?.traceId,
        label: defineRemoteConversationMessage("remoteConversation.contextComposed"),
        activeLabel: defineRemoteConversationMessage("remoteConversation.composingContext"),
        icon: LayersIcon,
      },
    });
    return {
      dispose() {
        message.dispose();
        renderer.dispose();
        presentation.dispose();
      },
    };
  },
});

const REMOTE_CONVERSATION_EXTENSIONS = Object.freeze([remoteConversationPresentationExtension]);

export interface RemoteConversationPalette {
  readonly background: string;
  readonly surface: string;
  readonly subtleSurface: string;
  readonly foreground: string;
  readonly muted: string;
  readonly border: string;
  readonly accent: string;
  readonly accentText: string;
  readonly danger: string;
  readonly warningText: string;
  readonly userSurface: string;
}

export interface RemoteConversationSurfaceProps {
  readonly sessionId: string;
  readonly items: readonly RemoteConversationItemV1[];
  readonly loading: boolean;
  readonly loadFailed: boolean;
  readonly hasMore: boolean;
  readonly ready: boolean;
  readonly dark: boolean;
  readonly palette: RemoteConversationPalette;
  readonly onLoadMore?: () => Promise<void>;
}

function RemoteConversationSurfaceContent({
  nodesLength,
  loading,
  loadFailed,
  hasMore,
  ready,
  dark,
  palette,
  onLoadMore,
}: Omit<RemoteConversationSurfaceProps, "sessionId" | "items"> & {
  readonly nodesLength: number;
}) {
  const { t } = useI18n(remoteConversationTranslationBundle);
  const viewportRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);
  const [loadingOlder, setLoadingOlder] = useState(false);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !followLatestRef.current) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [nodesLength]);

  const loadOlder = async () => {
    const viewport = viewportRef.current;
    if (!viewport || loadingOlder || !ready || !hasMore || !onLoadMore) return;
    const previousHeight = viewport.scrollHeight;
    const previousTop = viewport.scrollTop;
    setLoadingOlder(true);
    try {
      await onLoadMore();
      requestAnimationFrame(() => {
        const current = viewportRef.current;
        if (current) current.scrollTop = previousTop + current.scrollHeight - previousHeight;
      });
    } finally {
      setLoadingOlder(false);
    }
  };

  const theme = {
    "--background": palette.background,
    "--foreground": palette.foreground,
    "--card": palette.surface,
    "--card-foreground": palette.foreground,
    "--popover": palette.surface,
    "--popover-foreground": palette.foreground,
    "--primary": palette.accent,
    "--primary-foreground": palette.accentText,
    "--secondary": palette.subtleSurface,
    "--secondary-foreground": palette.foreground,
    "--muted": palette.subtleSurface,
    "--muted-foreground": palette.muted,
    "--accent": palette.subtleSurface,
    "--accent-foreground": palette.foreground,
    "--destructive": palette.danger,
    "--warning-foreground": palette.warningText,
    "--border": palette.border,
    "--input": palette.border,
    "--ring": palette.accent,
    "--aui-background": palette.background,
    "--aui-foreground": palette.foreground,
    "--aui-muted-foreground": palette.muted,
    "--aui-border": palette.border,
    "--aui-user-message": palette.userSurface,
    "--assistant-turn-min-height": "5.25rem",
  } as CSSProperties;

  return (
    <div
      data-slot="workbench-conversation"
      data-workbench-surface="remote-mobile"
      className={`${dark ? "dark " : ""}bg-background text-foreground h-dvh min-h-0 w-full overflow-hidden`}
      style={theme}
    >
      <div
        ref={viewportRef}
        className="h-full min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain"
        onScroll={(event) => {
          const viewport = event.currentTarget;
          followLatestRef.current =
            viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80;
        }}
      >
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-2 py-5">
          {hasMore ? (
            <Button
              type="button"
              data-frame="none"
              variant="ghost"
              disabled={!ready || loadingOlder}
              className="text-muted-foreground mx-auto mb-4 shrink-0"
              onClick={() => void loadOlder()}
            >
              {loadingOlder ? (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              ) : (
                <ChevronUpIcon aria-hidden="true" />
              )}
              {t("remoteConversation.loadOlder")}
            </Button>
          ) : null}
          {loading && nodesLength === 0 ? (
            <div
              role="status"
              className="text-muted-foreground flex flex-1 items-center justify-center gap-2"
            >
              <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              {t("remoteConversation.loading")}
            </div>
          ) : loadFailed ? (
            <p
              role="alert"
              className="text-muted-foreground flex flex-1 items-center justify-center text-center"
            >
              {t("remoteConversation.loadError")}
            </p>
          ) : nodesLength === 0 ? (
            <p className="text-muted-foreground flex flex-1 items-center justify-center text-center">
              {t("remoteConversation.empty")}
            </p>
          ) : (
            <ConversationList
              renderWorkingStatus={() => (
                <div className="text-muted-foreground flex h-10 items-center gap-2 text-sm">
                  <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
                  {t("remoteConversation.assistantWorking")}
                </div>
              )}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function RemoteConversationSurface(props: RemoteConversationSurfaceProps) {
  const nodes = useMemo(() => remoteConversationNodes(props.items), [props.items]);
  const runtime = useMemo(
    () => new RemoteConversationAgentRuntime(props.sessionId),
    [props.sessionId],
  );
  const panelStore = useMemo(() => createPanelStore(), []);

  useEffect(() => {
    runtime.replace({ nodes, loading: props.loading, hasMore: props.hasMore });
  }, [nodes, props.hasMore, props.loading, runtime]);

  return (
    <WorkbenchSettingsProvider service={REMOTE_PRESENTATION_SETTINGS}>
      <ExtensionProvider extensions={REMOTE_CONVERSATION_EXTENSIONS} panelStore={panelStore}>
        <RuntimeProvider runtime={runtime}>
          <WorkbenchAgentRuntimeEnvironmentProvider
            id="workbench.remote-readonly"
            threadId={props.sessionId}
            commands={REMOTE_AGENT_COMMANDS}
          >
            <SessionProvider sessionId={props.sessionId}>
              <RemoteConversationSurfaceContent {...props} nodesLength={nodes.length} />
            </SessionProvider>
          </WorkbenchAgentRuntimeEnvironmentProvider>
        </RuntimeProvider>
      </ExtensionProvider>
    </WorkbenchSettingsProvider>
  );
}
