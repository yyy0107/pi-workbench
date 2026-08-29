"use client";

import {
  BotIcon,
  ChevronDownIcon,
  GitBranchIcon,
  Trash2Icon,
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
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n";
import { workflowClient } from "@/runtime/pi/client/workflows/workflow-client";
import type {
  ConditionOperator,
  FlowNode,
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
  if (!document || document.id !== surface.params.workflowId) {
    return (
      <div className="text-muted-foreground p-4 text-sm">
        {t("extensions.workflows.editor.empty")}
      </div>
    );
  }
  return (
    <div className="h-full min-h-0 overflow-y-auto p-4">
      <NodeInspector />
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
