"use client";

import { useState } from "react";
import {
  BotIcon,
  CalendarClockIcon,
  ChevronDownIcon,
  GitBranchIcon,
  PlusIcon,
  Trash2Icon,
  ZapIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuRadioGroup } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  SettingsDropdownContent,
  SettingsDropdownRadioItem,
  SettingsDropdownTrigger,
} from "@/components/ui/settings-control";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n";
import { usePiWorkspaces } from "@/runtime/pi/client/runtime/context";
import { workflowClient } from "@/runtime/pi/client/workflows/workflow-client";
import type {
  ConditionOperator,
  FlowNode,
  TriggerSpec,
  WorkflowJsonValue,
} from "@/runtime/shared/execution";
import type { WorkspaceSurfaceProps } from "@/platform/extensions/authoring";

import { useWorkflowEditorStore } from "../execution-state";

export interface WorkflowInspectorParams extends Record<string, unknown> {
  workflowId: string;
}

const fieldClass =
  "flex flex-col gap-1.5 [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted-foreground";

function patchNode(node: FlowNode, field: string, value: unknown): FlowNode {
  if (field === "name") return { ...node, name: String(value) };
  switch (node.type) {
    case "agent":
      if (field === "agentId") {
        return { ...node, config: { ...node.config, agentId: String(value) } };
      }
      if (field === "promptTemplate") {
        return {
          ...node,
          config: { ...node.config, promptTemplate: String(value) || undefined },
        };
      }
      return {
        ...node,
        config: {
          ...node.config,
          output: { schema: value as WorkflowJsonValue },
        },
      };
    case "command":
      if (field === "relativeCwd") {
        return {
          ...node,
          config: { ...node.config, relativeCwd: String(value) || undefined },
        };
      }
      if (field === "timeoutSeconds") {
        const timeoutSeconds = Number(value);
        return {
          ...node,
          config: {
            ...node.config,
            timeoutSeconds: Number.isFinite(timeoutSeconds) ? timeoutSeconds : undefined,
          },
        };
      }
      return { ...node, config: { ...node.config, command: String(value) } };
    case "condition":
      if (field === "path") {
        return {
          ...node,
          config: { ...node.config, binding: { ...node.config.binding, path: String(value) } },
        };
      }
      if (field === "operator") {
        return {
          ...node,
          config: { ...node.config, operator: value as ConditionOperator },
        };
      }
      return { ...node, config: { ...node.config, value: value as WorkflowJsonValue } };
    case "approval":
      return { ...node, config: { ...node.config, message: String(value) } };
    default:
      return node;
  }
}

export function WorkflowInspectorSurface({
  surface,
}: WorkspaceSurfaceProps<WorkflowInspectorParams>) {
  const { t } = useI18n();
  const document = useWorkflowEditorStore((state) => state.document);
  const inspectorTab = useWorkflowEditorStore((state) => state.inspectorTab);
  const setInspectorTab = useWorkflowEditorStore((state) => state.setInspectorTab);
  if (!document || document.id !== surface.params.workflowId) {
    return (
      <div className="text-muted-foreground p-4 text-sm">
        {t("extensions.workflows.editor.empty")}
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border flex shrink-0 gap-1 border-b p-2">
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={inspectorTab === "node"}
          onClick={() => setInspectorTab("node")}
        >
          <GitBranchIcon />
          {t("extensions.workflows.inspector.nodeTab")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={inspectorTab === "trigger"}
          onClick={() => setInspectorTab("trigger")}
        >
          <ZapIcon />
          {t("extensions.workflows.inspector.triggerTab")}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {inspectorTab === "trigger" ? <TriggerInspector /> : <NodeInspector />}
      </div>
    </div>
  );
}

function NodeInspector() {
  const { t } = useI18n();
  const document = useWorkflowEditorStore((state) => state.document)!;
  const selection = useWorkflowEditorStore((state) => state.selection);
  const updateDocument = useWorkflowEditorStore((state) => state.updateDocument);
  const setSelection = useWorkflowEditorStore((state) => state.setSelection);
  const node =
    selection?.type === "node"
      ? document.graph.nodes.find(({ id }) => id === selection.id)
      : undefined;
  if (!node) {
    return (
      <div className="text-muted-foreground flex min-h-48 flex-col items-center justify-center gap-3 text-center text-sm">
        <GitBranchIcon aria-hidden="true" className="size-6" />
        <p>{t("extensions.workflows.inspector.noSelection")}</p>
      </div>
    );
  }
  const selectedAgent =
    node.type === "agent"
      ? document.agents.find((agent) => agent.id === node.config.agentId)
      : undefined;
  const update = (field: string, value: unknown) =>
    updateDocument((current) => ({
      ...current,
      graph: {
        ...current.graph,
        nodes: current.graph.nodes.map((candidate) =>
          candidate.id === node.id ? patchNode(candidate, field, value) : candidate,
        ),
      },
    }));
  const remove = () => {
    updateDocument((current) => ({
      ...current,
      graph: {
        ...current.graph,
        nodes: current.graph.nodes.filter(({ id }) => id !== node.id),
        edges: current.graph.edges.filter(
          ({ source, target }) => source !== node.id && target !== node.id,
        ),
      },
    }));
    setSelection(undefined);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className={fieldClass}>
        <label htmlFor="workflow-node-name">{t("extensions.workflows.inspector.name")}</label>
        <Input
          id="workflow-node-name"
          value={node.name}
          onChange={(event) => update("name", event.currentTarget.value)}
        />
      </div>
      {node.type === "agent" ? (
        <>
          <div className={fieldClass}>
            <label htmlFor="workflow-node-agent">{t("extensions.workflows.inspector.agent")}</label>
            <DropdownMenu>
              <SettingsDropdownTrigger
                id="workflow-node-agent"
                type="button"
                className="w-full justify-start"
              >
                <BotIcon aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-start">
                  {selectedAgent?.name ?? node.config.agentId}
                </span>
                <ChevronDownIcon aria-hidden="true" className="text-muted-foreground" />
              </SettingsDropdownTrigger>
              <SettingsDropdownContent align="start" className="w-(--anchor-width)">
                <DropdownMenuRadioGroup
                  value={node.config.agentId}
                  onValueChange={(agentId) => update("agentId", agentId)}
                >
                  {document.agents.map((agent) => (
                    <SettingsDropdownRadioItem key={agent.id} value={agent.id}>
                      <BotIcon aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                    </SettingsDropdownRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </SettingsDropdownContent>
            </DropdownMenu>
          </div>
          <div className={fieldClass}>
            <label htmlFor="workflow-node-prompt-template">
              {t("extensions.workflows.inspector.promptTemplate")}
            </label>
            <Input
              id="workflow-node-prompt-template"
              value={node.config.promptTemplate ?? ""}
              onChange={(event) => update("promptTemplate", event.currentTarget.value)}
            />
          </div>
          <div className={fieldClass}>
            <label htmlFor="workflow-node-output-schema">
              {t("extensions.workflows.inspector.outputSchema")}
            </label>
            <Textarea
              key={`${node.id}:${JSON.stringify(node.config.output.schema)}`}
              id="workflow-node-output-schema"
              rows={8}
              defaultValue={JSON.stringify(node.config.output.schema, null, 2)}
              onBlur={(event) => {
                try {
                  update("outputSchema", JSON.parse(event.currentTarget.value));
                } catch {
                  event.currentTarget.value = JSON.stringify(node.config.output.schema, null, 2);
                }
              }}
            />
          </div>
        </>
      ) : null}
      {node.type === "command" ? (
        <>
          <div className={fieldClass}>
            <label htmlFor="workflow-node-command">
              {t("extensions.workflows.inspector.command")}
            </label>
            <Textarea
              id="workflow-node-command"
              rows={6}
              value={node.config.command}
              onChange={(event) => update("command", event.currentTarget.value)}
            />
          </div>
          <div className={fieldClass}>
            <label htmlFor="workflow-node-cwd">
              {t("extensions.workflows.inspector.relativeCwd")}
            </label>
            <Input
              id="workflow-node-cwd"
              value={node.config.relativeCwd ?? ""}
              onChange={(event) => update("relativeCwd", event.currentTarget.value)}
            />
          </div>
          <div className={fieldClass}>
            <label htmlFor="workflow-node-timeout">
              {t("extensions.workflows.inspector.timeout")}
            </label>
            <Input
              id="workflow-node-timeout"
              type="number"
              min={1}
              max={86400}
              value={node.config.timeoutSeconds ?? 600}
              onChange={(event) => update("timeoutSeconds", event.currentTarget.value)}
            />
          </div>
        </>
      ) : null}
      {node.type === "condition" ? (
        <>
          <div className={fieldClass}>
            <label htmlFor="workflow-node-path">
              {t("extensions.workflows.inspector.bindingPath")}
            </label>
            <Input
              id="workflow-node-path"
              value={node.config.binding.path}
              onChange={(event) => update("path", event.currentTarget.value)}
            />
          </div>
          <div className={fieldClass}>
            <label htmlFor="workflow-node-operator">
              {t("extensions.workflows.inspector.operator")}
            </label>
            <Select
              id="workflow-node-operator"
              value={node.config.operator}
              onChange={(event) => update("operator", event.currentTarget.value)}
            >
              {(["equals", "not-equals", "exists", "contains", "greater-than"] as const).map(
                (operator) => (
                  <option key={operator} value={operator}>
                    {operator}
                  </option>
                ),
              )}
            </Select>
          </div>
          <div className={fieldClass}>
            <label htmlFor="workflow-node-value">
              {t("extensions.workflows.inspector.compareValue")}
            </label>
            <Input
              id="workflow-node-value"
              value={node.config.value === undefined ? "" : JSON.stringify(node.config.value)}
              onChange={(event) => {
                try {
                  update("value", JSON.parse(event.currentTarget.value) as WorkflowJsonValue);
                } catch {
                  update("value", event.currentTarget.value);
                }
              }}
            />
          </div>
        </>
      ) : null}
      {node.type === "approval" ? (
        <div className={fieldClass}>
          <label htmlFor="workflow-node-approval">
            {t("extensions.workflows.inspector.approvalMessage")}
          </label>
          <Textarea
            id="workflow-node-approval"
            rows={5}
            value={node.config.message}
            onChange={(event) => update("message", event.currentTarget.value)}
          />
        </div>
      ) : null}
      {node.type === "start" || node.type === "end" ? (
        <p className="text-muted-foreground text-xs">
          {t("extensions.workflows.inspector.startEndLocked")}
        </p>
      ) : (
        <Button variant="destructive" className="self-start" onClick={remove}>
          <Trash2Icon />
          {t("extensions.workflows.inspector.removeNode")}
        </Button>
      )}
    </div>
  );
}

function TriggerInspector() {
  const { t } = useI18n();
  const workspaces = usePiWorkspaces();
  const document = useWorkflowEditorStore((state) => state.document)!;
  const triggerStates = useWorkflowEditorStore((state) => state.triggerStates);
  const saveState = useWorkflowEditorStore((state) => state.saveState);
  const updateDocument = useWorkflowEditorStore((state) => state.updateDocument);
  const setTriggerState = useWorkflowEditorStore((state) => state.setTriggerState);
  const [pendingId, setPendingId] = useState<string>();
  const update = (triggerId: string, patch: Partial<TriggerSpec>) =>
    updateDocument((current) => ({
      ...current,
      triggers: current.triggers.map((trigger) =>
        trigger.id === triggerId ? ({ ...trigger, ...patch } as TriggerSpec) : trigger,
      ),
    }));
  const add = (type: TriggerSpec["type"]) => {
    const id = globalThis.crypto.randomUUID();
    const targetWorkspaceId = document.scope.type === "personal" ? workspaces[0]?.id : undefined;
    const trigger: TriggerSpec =
      type === "schedule"
        ? {
            id,
            type,
            name: t("extensions.workflows.triggers.schedule"),
            cron: "0 9 * * 1-5",
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            ...(targetWorkspaceId ? { targetWorkspaceId } : {}),
          }
        : {
            id,
            type,
            name: t("extensions.workflows.triggers.event"),
            event: "workbench.session.completed",
            ...(targetWorkspaceId ? { targetWorkspaceId } : {}),
          };
    updateDocument((current) => ({ ...current, triggers: [...current.triggers, trigger] }));
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold">{t("extensions.workflows.triggers.title")}</h2>
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
          {t("extensions.workflows.triggers.description")}
        </p>
      </div>
      <div className="flex flex-wrap gap-1">
        <Button variant="outline" size="xs" onClick={() => add("schedule")}>
          <CalendarClockIcon />
          {t("extensions.workflows.triggers.addSchedule")}
        </Button>
        <Button variant="outline" size="xs" onClick={() => add("event")}>
          <PlusIcon />
          {t("extensions.workflows.triggers.addEvent")}
        </Button>
      </div>
      {document.triggers.length === 0 ? (
        <p className="text-muted-foreground py-6 text-center text-sm">
          {t("extensions.workflows.triggers.empty")}
        </p>
      ) : null}
      {document.triggers.map((trigger) => {
        const state = triggerStates.find(({ triggerId }) => triggerId === trigger.id);
        const canEnable =
          Boolean(document.publishedRevisionId) &&
          !["dirty", "saving", "conflict"].includes(saveState);
        return (
          <section key={trigger.id} className="rounded-[var(--radius-lg)] border p-3">
            <div className="mb-3 flex items-center gap-2">
              {trigger.type === "schedule" ? (
                <CalendarClockIcon className="size-4" />
              ) : (
                <ZapIcon className="size-4" />
              )}
              <span className="flex-1 text-sm font-medium">
                {trigger.type === "schedule"
                  ? t("extensions.workflows.triggers.schedule")
                  : t("extensions.workflows.triggers.event")}
              </span>
              <Switch
                size="compact"
                checked={state?.enabled ?? false}
                disabled={!canEnable || pendingId === trigger.id}
                aria-label={t("extensions.workflows.triggers.enabled")}
                onCheckedChange={async (enabled) => {
                  setPendingId(trigger.id);
                  try {
                    setTriggerState(
                      await workflowClient.setTriggerEnabled({
                        workflowId: document.id,
                        triggerId: trigger.id,
                        enabled,
                      }),
                    );
                  } finally {
                    setPendingId(undefined);
                  }
                }}
              />
            </div>
            {!document.publishedRevisionId ? (
              <p className="text-muted-foreground mb-3 text-xs">
                {t("extensions.workflows.triggers.publishToEnable")}
              </p>
            ) : null}
            <div className="flex flex-col gap-3">
              <div className={fieldClass}>
                <label htmlFor={`trigger-name-${trigger.id}`}>
                  {t("extensions.workflows.triggers.name")}
                </label>
                <Input
                  id={`trigger-name-${trigger.id}`}
                  value={trigger.name}
                  onChange={(event) => update(trigger.id, { name: event.currentTarget.value })}
                />
              </div>
              {trigger.type === "schedule" ? (
                <>
                  <div className={fieldClass}>
                    <label htmlFor={`trigger-cron-${trigger.id}`}>
                      {t("extensions.workflows.triggers.cron")}
                    </label>
                    <Input
                      id={`trigger-cron-${trigger.id}`}
                      value={trigger.cron}
                      onChange={(event) => update(trigger.id, { cron: event.currentTarget.value })}
                    />
                  </div>
                  <div className={fieldClass}>
                    <label htmlFor={`trigger-tz-${trigger.id}`}>
                      {t("extensions.workflows.triggers.timezone")}
                    </label>
                    <Input
                      id={`trigger-tz-${trigger.id}`}
                      value={trigger.timezone}
                      onChange={(event) =>
                        update(trigger.id, { timezone: event.currentTarget.value })
                      }
                    />
                  </div>
                </>
              ) : (
                <div className={fieldClass}>
                  <label htmlFor={`trigger-event-${trigger.id}`}>
                    {t("extensions.workflows.triggers.eventName")}
                  </label>
                  <Select
                    id={`trigger-event-${trigger.id}`}
                    value={trigger.event}
                    onChange={(event) =>
                      update(trigger.id, {
                        event: event.currentTarget.value as Extract<
                          TriggerSpec,
                          { type: "event" }
                        >["event"],
                      })
                    }
                  >
                    <option value="workbench.application.started">
                      workbench.application.started
                    </option>
                    <option value="workbench.session.completed">workbench.session.completed</option>
                    <option value="workbench.workspace.updated">workbench.workspace.updated</option>
                  </Select>
                </div>
              )}
              {document.scope.type === "personal" ? (
                <div className={fieldClass}>
                  <label htmlFor={`trigger-workspace-${trigger.id}`}>
                    {t("extensions.workflows.triggers.targetWorkspace")}
                  </label>
                  <Select
                    id={`trigger-workspace-${trigger.id}`}
                    value={trigger.targetWorkspaceId ?? ""}
                    onChange={(event) =>
                      update(trigger.id, {
                        targetWorkspaceId: event.currentTarget.value || undefined,
                      })
                    }
                  >
                    <option value="">—</option>
                    {workspaces.map((workspace) => (
                      <option key={workspace.id} value={workspace.id}>
                        {workspace.name}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}
              <Button
                variant="ghost"
                size="xs"
                className="self-start text-destructive"
                onClick={() =>
                  updateDocument((current) => ({
                    ...current,
                    triggers: current.triggers.filter(({ id }) => id !== trigger.id),
                  }))
                }
              >
                <Trash2Icon />
                {t("extensions.workflows.triggers.remove")}
              </Button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
