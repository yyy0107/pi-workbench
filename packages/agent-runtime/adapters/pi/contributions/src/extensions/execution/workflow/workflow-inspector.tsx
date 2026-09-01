"use client";

import { useEffect, useId, useRef, useState, type ComponentType } from "react";
import {
  BlocksIcon,
  FolderIcon,
  GitBranchIcon,
  LoaderCircleIcon,
  PuzzleIcon,
  Trash2Icon,
} from "lucide-react";

import { Button } from "@workbench/shell/ui";
import { Input } from "@workbench/shell/ui";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@workbench/shell/ui";
import { Select } from "@workbench/shell/ui";
import { Textarea } from "@workbench/shell/ui";
import { usePiI18n } from "../../../i18n";
import { usePiExecutionClient } from "@workbench/agent-runtime-pi-client/execution";
import type {
  ConditionOperator,
  FlowNode,
  WorkflowAgentExtensionResource,
  WorkflowAgentResourcesValue,
  WorkflowAgentSkillResource,
  WorkflowJsonValue,
} from "@workbench/execution-contracts";
import type { WorkspaceSurfaceProps } from "@workbench/extension-sdk";

import { useWorkflowEditorStore } from "../execution-state";

export interface WorkflowInspectorParams extends Record<string, unknown> {
  workflowId: string;
}

const fieldClass =
  "flex flex-col gap-1.5 [&>label]:text-xs [&>label]:font-medium [&>label]:text-muted-foreground";

type AgentFlowNode = Extract<FlowNode, { type: "agent" }>;
type AgentResourceItem = WorkflowAgentSkillResource | WorkflowAgentExtensionResource;
type AgentResourceLoadState = "idle" | "loading" | "ready" | "error";
type PromptSaveState = "idle" | "dirty" | "saving" | "saved" | "error";

function patchNode(node: FlowNode, field: string, value: unknown): FlowNode {
  if (field === "name") return { ...node, name: String(value) };
  switch (node.type) {
    case "agent":
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
  const { t } = usePiI18n();
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

function resourceScopeLabel(
  scope: AgentResourceItem["scope"],
  t: ReturnType<typeof usePiI18n>["t"],
): string {
  switch (scope) {
    case "project":
      return t("extensions.workflows.inspector.resourceScope.agent");
    case "temporary":
      return t("extensions.workflows.inspector.resourceScope.temporary");
    default:
      return t("extensions.workflows.inspector.resourceScope.user");
  }
}

function AgentResourceList({
  id,
  title,
  empty,
  loading,
  unavailable,
  items,
  icon: Icon,
}: {
  id: string;
  title: string;
  empty: string;
  loading: boolean;
  unavailable: boolean;
  items: AgentResourceItem[];
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}) {
  const { t } = usePiI18n();
  return (
    <section className="flex flex-col gap-1.5" aria-labelledby={id}>
      <div className="flex items-center gap-1.5">
        <Icon aria-hidden className="text-muted-foreground size-[var(--icon-size-sm)]" />
        <h3 id={id} className="text-xs font-medium text-muted-foreground">
          {title}
        </h3>
        {!loading && !unavailable ? (
          <span className="ml-auto rounded-[var(--button-radius)] bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
            {items.length}
          </span>
        ) : null}
      </div>
      <div className="overflow-hidden rounded-[var(--input-control-radius)] border border-border bg-muted/20">
        {loading ? (
          <div className="flex min-h-[var(--control-hit-touch)] items-center gap-2 px-2.5 text-xs text-muted-foreground">
            <LoaderCircleIcon aria-hidden className="size-[var(--icon-size-sm)] animate-spin" />
            {t("extensions.workflows.inspector.resourcesLoading")}
          </div>
        ) : unavailable ? (
          <p className="px-2.5 py-3 text-xs text-muted-foreground">
            {t("extensions.workflows.inspector.resourcesUnavailable")}
          </p>
        ) : items.length === 0 ? (
          <p className="px-2.5 py-3 text-xs text-muted-foreground">{empty}</p>
        ) : (
          <ul className="max-h-44 divide-y divide-border overflow-y-auto">
            {items.map((item, index) => {
              const source =
                item.origin === "package" && !["auto", "local"].includes(item.source)
                  ? item.source
                  : resourceScopeLabel(item.scope, t);
              const manualOnly = "modelInvocable" in item && !item.modelInvocable;
              return (
                <li
                  key={`${item.scope}:${item.source}:${item.name}:${index}`}
                  className="flex min-w-0 items-start gap-2 px-2.5 py-2"
                >
                  <Icon
                    aria-hidden
                    className="mt-0.5 size-[var(--icon-size-sm)] shrink-0 text-muted-foreground"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-xs font-medium">{item.name}</span>
                      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                        {source}
                      </span>
                    </div>
                    {"description" in item && item.description ? (
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                        {item.description}
                      </p>
                    ) : null}
                    {manualOnly ? (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {t("extensions.workflows.inspector.skillManualOnly")}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function AgentConfigurationFields({
  workflowId,
  node,
  update,
}: {
  workflowId: string;
  node: AgentFlowNode;
  update(field: string, value: unknown): void;
}) {
  const { workflow: workflowClient } = usePiExecutionClient();
  const { t } = usePiI18n();
  const domScopeId = useId();
  const promptTemplateId = `${domScopeId}-workflow-node-prompt-template`;
  const promptTemplateErrorId = `${domScopeId}-workflow-node-prompt-template-error`;
  const promptId = `${domScopeId}-workflow-node-prompt`;
  const promptStatusId = `${domScopeId}-workflow-node-prompt-status`;
  const skillsId = `${domScopeId}-workflow-node-skills`;
  const extensionsId = `${domScopeId}-workflow-node-extensions`;
  const promptTemplate = node.config.promptTemplate?.trim() ?? "";
  const resourceKey = `${workflowId}:${node.config.agentId}:${promptTemplate}`;
  const activeResourceKey = useRef(resourceKey);
  const [resources, setResources] = useState<WorkflowAgentResourcesValue>();
  const [prompt, setPrompt] = useState("");
  const promptRef = useRef(prompt);
  const [loadState, setLoadState] = useState<AgentResourceLoadState>("idle");
  const [promptSaveState, setPromptSaveState] = useState<PromptSaveState>("idle");
  activeResourceKey.current = resourceKey;
  promptRef.current = prompt;

  useEffect(() => {
    let cancelled = false;
    setResources(undefined);
    setPrompt("");
    setPromptSaveState("idle");
    if (!promptTemplate) {
      setLoadState("idle");
      return;
    }

    setLoadState("loading");
    const timeout = window.setTimeout(() => {
      void workflowClient
        .readAgentResources({
          workflowId,
          agentId: node.config.agentId,
          promptTemplate,
        })
        .then((nextResources) => {
          if (cancelled) return;
          setResources(nextResources);
          setPrompt(nextResources.prompt);
          setLoadState("ready");
        })
        .catch(() => {
          if (cancelled) return;
          setLoadState("error");
        });
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [node.config.agentId, promptTemplate, workflowId]);

  const savePrompt = async () => {
    if (
      !resources ||
      loadState !== "ready" ||
      promptSaveState === "saving" ||
      prompt === resources.prompt
    ) {
      return;
    }
    const savingResourceKey = resourceKey;
    const savingPrompt = prompt;
    setPromptSaveState("saving");
    try {
      const nextResources = await workflowClient.updateAgentResources({
        workflowId,
        agentId: node.config.agentId,
        promptTemplate,
        prompt,
        ...(resources.model ? { model: resources.model } : {}),
      });
      if (activeResourceKey.current !== savingResourceKey) return;
      setResources(nextResources);
      if (promptRef.current === savingPrompt) {
        setPrompt(nextResources.prompt);
        setPromptSaveState("saved");
      } else {
        setPromptSaveState("dirty");
      }
    } catch {
      if (activeResourceKey.current === savingResourceKey) setPromptSaveState("error");
    }
  };

  const promptStatus =
    loadState === "loading"
      ? t("extensions.workflows.inspector.promptLoading")
      : loadState === "error"
        ? t("extensions.workflows.inspector.promptLoadError")
        : promptSaveState === "saving"
          ? t("extensions.workflows.inspector.promptSaving")
          : promptSaveState === "saved"
            ? t("extensions.workflows.inspector.promptSaved")
            : promptSaveState === "error"
              ? t("extensions.workflows.inspector.promptSaveError")
              : promptSaveState === "dirty"
                ? t("extensions.workflows.inspector.promptUnsaved")
                : t("extensions.workflows.inspector.promptDescription");
  const promptUnavailable = !promptTemplate || loadState === "error";
  const resourcesLoading = loadState === "loading";
  const resourcesUnavailable = loadState === "error" || resources?.catalogAvailable === false;

  return (
    <>
      <div className={fieldClass}>
        <label htmlFor={promptTemplateId}>
          {t("extensions.workflows.inspector.promptTemplate")}
        </label>
        <Input
          id={promptTemplateId}
          value={node.config.promptTemplate ?? ""}
          aria-invalid={!promptTemplate}
          aria-describedby={!promptTemplate ? promptTemplateErrorId : undefined}
          onChange={(event) => update("promptTemplate", event.currentTarget.value)}
        />
        {!promptTemplate ? (
          <p id={promptTemplateErrorId} className="text-xs text-destructive">
            {t("extensions.workflows.inspector.promptTemplateRequired")}
          </p>
        ) : null}
      </div>
      <div className={fieldClass}>
        <label htmlFor={promptId}>{t("extensions.workflows.inspector.prompt")}</label>
        <Textarea
          id={promptId}
          className="min-h-36 resize-y"
          value={prompt}
          disabled={promptUnavailable || loadState === "loading"}
          aria-busy={loadState === "loading"}
          aria-invalid={promptSaveState === "error"}
          aria-describedby={promptStatusId}
          onChange={(event) => {
            const nextPrompt = event.currentTarget.value;
            setPrompt(nextPrompt);
            setPromptSaveState(nextPrompt === resources?.prompt ? "idle" : "dirty");
          }}
          onBlur={() => void savePrompt()}
        />
        <p
          id={promptStatusId}
          role={loadState === "error" || promptSaveState === "error" ? "alert" : undefined}
          aria-live="polite"
          className={
            loadState === "error" || promptSaveState === "error"
              ? "text-xs text-destructive"
              : "text-xs leading-relaxed text-muted-foreground"
          }
        >
          {promptStatus}
        </p>
      </div>
      <AgentResourceList
        id={skillsId}
        title={t("extensions.workflows.inspector.skills")}
        empty={t("extensions.workflows.inspector.noSkills")}
        loading={resourcesLoading}
        unavailable={resourcesUnavailable}
        items={resources?.skills ?? []}
        icon={BlocksIcon}
      />
      <AgentResourceList
        id={extensionsId}
        title={t("extensions.workflows.inspector.extensions")}
        empty={t("extensions.workflows.inspector.noExtensions")}
        loading={resourcesLoading}
        unavailable={resourcesUnavailable}
        items={resources?.extensions ?? []}
        icon={PuzzleIcon}
      />
      {resources && !resources.projectResourcesTrusted ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("extensions.workflows.inspector.resourcesRequireTrust")}
        </p>
      ) : null}
    </>
  );
}

function JsonSchemaEditor({
  node,
  update,
}: {
  node: AgentFlowNode;
  update(field: string, value: unknown): void;
}) {
  const { t } = usePiI18n();
  const domScopeId = useId();
  const outputSchemaId = `${domScopeId}-workflow-node-output-schema`;
  const outputSchemaHelpId = `${domScopeId}-workflow-node-output-schema-help`;
  const serializedSchema = JSON.stringify(node.config.output.schema, null, 2);
  const [value, setValue] = useState(serializedSchema);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setValue(serializedSchema);
    setError(undefined);
  }, [node.id, serializedSchema]);

  const validate = (nextValue: string): WorkflowJsonValue | undefined => {
    try {
      const parsed = JSON.parse(nextValue) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setError(t("extensions.workflows.inspector.outputSchemaObjectRequired"));
        return undefined;
      }
      setError(undefined);
      return parsed as WorkflowJsonValue;
    } catch {
      setError(t("extensions.workflows.inspector.outputSchemaInvalid"));
      return undefined;
    }
  };

  return (
    <div className={fieldClass}>
      <label htmlFor={outputSchemaId}>{t("extensions.workflows.inspector.outputSchema")}</label>
      <Textarea
        id={outputSchemaId}
        className="min-h-44 resize-y font-mono text-xs"
        rows={10}
        value={value}
        spellCheck={false}
        aria-invalid={Boolean(error)}
        aria-describedby={outputSchemaHelpId}
        onChange={(event) => {
          setValue(event.currentTarget.value);
          if (error) setError(undefined);
        }}
        onBlur={() => {
          const schema = validate(value);
          if (!schema) return;
          const formatted = JSON.stringify(schema, null, 2);
          setValue(formatted);
          update("outputSchema", schema);
        }}
      />
      <p
        id={outputSchemaHelpId}
        role={error ? "alert" : undefined}
        className={
          error ? "text-xs text-destructive" : "text-xs leading-relaxed text-muted-foreground"
        }
      >
        {error ?? t("extensions.workflows.inspector.outputSchemaDescription")}
      </p>
    </div>
  );
}

function NodeInspector() {
  const { t } = usePiI18n();
  const domScopeId = useId();
  const nameId = `${domScopeId}-workflow-node-name`;
  const agentId = `${domScopeId}-workflow-node-agent`;
  const agentDescriptionId = `${domScopeId}-workflow-node-agent-description`;
  const commandId = `${domScopeId}-workflow-node-command`;
  const cwdId = `${domScopeId}-workflow-node-cwd`;
  const timeoutId = `${domScopeId}-workflow-node-timeout`;
  const pathId = `${domScopeId}-workflow-node-path`;
  const operatorId = `${domScopeId}-workflow-node-operator`;
  const valueId = `${domScopeId}-workflow-node-value`;
  const approvalId = `${domScopeId}-workflow-node-approval`;
  const document = useWorkflowEditorStore((state) => state.document)!;
  const workflowDirectory = useWorkflowEditorStore((state) => state.workflowDirectory);
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
  const pathSeparator =
    workflowDirectory?.includes("\\") && !workflowDirectory.includes("/") ? "\\" : "/";
  const agentWorkspace =
    node.type === "agent" && workflowDirectory
      ? `${workflowDirectory.replace(/[\\/]+$/u, "")}${pathSeparator}agents${pathSeparator}${node.config.agentId}`
      : "";
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
        <label htmlFor={nameId}>{t("extensions.workflows.inspector.name")}</label>
        <Input
          id={nameId}
          value={node.name}
          onChange={(event) => update("name", event.currentTarget.value)}
        />
      </div>
      {node.type === "agent" ? (
        <>
          <div className={fieldClass}>
            <label htmlFor={agentId}>{t("extensions.workflows.inspector.agent")}</label>
            <InputGroup className="[background:var(--input-control-background-disabled)]">
              <InputGroupAddon>
                <FolderIcon aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                id={agentId}
                className="cursor-text font-mono text-xs"
                value={agentWorkspace}
                title={agentWorkspace}
                aria-describedby={agentDescriptionId}
                readOnly
              />
            </InputGroup>
            <p id={agentDescriptionId} className="text-xs leading-relaxed text-muted-foreground">
              {t("extensions.workflows.inspector.agentWorkspaceDescription")}
            </p>
          </div>
          <AgentConfigurationFields workflowId={document.id} node={node} update={update} />
          <JsonSchemaEditor node={node} update={update} />
        </>
      ) : null}
      {node.type === "command" ? (
        <>
          <div className={fieldClass}>
            <label htmlFor={commandId}>{t("extensions.workflows.inspector.command")}</label>
            <Textarea
              id={commandId}
              rows={6}
              value={node.config.command}
              onChange={(event) => update("command", event.currentTarget.value)}
            />
          </div>
          <div className={fieldClass}>
            <label htmlFor={cwdId}>{t("extensions.workflows.inspector.relativeCwd")}</label>
            <Input
              id={cwdId}
              value={node.config.relativeCwd ?? ""}
              onChange={(event) => update("relativeCwd", event.currentTarget.value)}
            />
          </div>
          <div className={fieldClass}>
            <label htmlFor={timeoutId}>{t("extensions.workflows.inspector.timeout")}</label>
            <Input
              id={timeoutId}
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
            <label htmlFor={pathId}>{t("extensions.workflows.inspector.bindingPath")}</label>
            <Input
              id={pathId}
              value={node.config.binding.path}
              onChange={(event) => update("path", event.currentTarget.value)}
            />
          </div>
          <div className={fieldClass}>
            <label htmlFor={operatorId}>{t("extensions.workflows.inspector.operator")}</label>
            <Select
              id={operatorId}
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
            <label htmlFor={valueId}>{t("extensions.workflows.inspector.compareValue")}</label>
            <Input
              id={valueId}
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
          <label htmlFor={approvalId}>{t("extensions.workflows.inspector.approvalMessage")}</label>
          <Textarea
            id={approvalId}
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
