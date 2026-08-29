"use client";

import {
  BotIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  PlusIcon,
  SquareTerminalIcon,
  Trash2Icon,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { FlowEdge, FlowNode, WorkflowDocument } from "@/runtime/shared/execution";

import { useWorkflowEditorStore } from "../execution-state";

type SopStep = Extract<FlowNode, { type: "agent" | "command" | "approval" }>;

const STEP_ICONS: Record<SopStep["type"], LucideIcon> = {
  agent: BotIcon,
  command: SquareTerminalIcon,
  approval: CheckCircle2Icon,
};

function orderedSteps(document: WorkflowDocument): SopStep[] {
  const nodes = new Map(document.graph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map(document.graph.edges.map((edge) => [edge.source, edge.target]));
  const steps: SopStep[] = [];
  let id = outgoing.get(document.graph.nodes.find(({ type }) => type === "start")?.id ?? "");
  const visited = new Set<string>();
  while (id && !visited.has(id)) {
    visited.add(id);
    const node = nodes.get(id);
    if (!node || node.type === "end") break;
    if (node.type === "agent" || node.type === "command" || node.type === "approval")
      steps.push(node);
    id = outgoing.get(id);
  }
  return steps;
}

function rebuild(document: WorkflowDocument, steps: readonly SopStep[]): WorkflowDocument {
  const start = document.graph.nodes.find(({ type }) => type === "start")!;
  const end = document.graph.nodes.find(({ type }) => type === "end")!;
  const sequence = [start.id, ...steps.map(({ id }) => id), end.id];
  const edges: FlowEdge[] = sequence.slice(0, -1).map((source, index) => ({
    id: `${source}-${sequence[index + 1]}`,
    source,
    target: sequence[index + 1]!,
  }));
  return {
    ...document,
    agents: [
      ...new Map(
        [
          ...document.agents,
          ...steps.flatMap((step) =>
            step.type === "agent" ? [{ id: step.config.agentId, name: step.name }] : [],
          ),
        ].map((agent) => [agent.id, agent]),
      ).values(),
    ],
    graph: {
      ...document.graph,
      nodes: [start, ...steps, end].map((node, index) => ({
        ...node,
        position: { x: 80, y: 80 + index * 140 },
      })),
      edges,
    },
  };
}

function createStep(type: SopStep["type"], name: string): SopStep {
  const base = { id: globalThis.crypto.randomUUID(), name, position: { x: 80, y: 80 } };
  if (type === "agent") {
    return {
      ...base,
      type,
      config: { agentId: base.id, promptTemplate: "default", output: { schema: {} } },
    };
  }
  if (type === "command") return { ...base, type, config: { command: "" } };
  return { ...base, type, config: { message: "Please approve this step." } };
}

export function SopStepListRenderer({
  document,
  onNodeSelect,
}: {
  document: WorkflowDocument;
  onNodeSelect(): void;
}) {
  const { t } = useI18n();
  const updateDocument = useWorkflowEditorStore((state) => state.updateDocument);
  const selection = useWorkflowEditorStore((state) => state.selection);
  const setSelection = useWorkflowEditorStore((state) => state.setSelection);
  const steps = orderedSteps(document);
  const labels: Record<SopStep["type"], string> = {
    agent: t("extensions.workflows.node.agent"),
    command: t("extensions.workflows.node.command"),
    approval: t("extensions.workflows.node.approval"),
  };
  const setSteps = (next: SopStep[]) => updateDocument((current) => rebuild(current, next));
  const selectNode = (nodeId: string) => {
    setSelection({ type: "node", id: nodeId });
    onNodeSelect();
  };

  return (
    <div className="h-full overflow-y-auto bg-muted/20 px-4 py-6 sm:px-8">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-2">
        {steps.map((step, index) => {
          const Icon = STEP_ICONS[step.type];
          const selected = selection?.type === "node" && selection.id === step.id;
          return (
            <div key={step.id} className="relative pb-6 last:pb-0">
              {index < steps.length - 1 ? (
                <div className="bg-border absolute top-12 bottom-0 left-6 w-px" />
              ) : null}
              <button
                type="button"
                aria-current={selected ? "step" : undefined}
                className={cn(
                  "bg-card focus-visible:ring-ring relative flex min-h-14 w-full items-center gap-3 rounded-[var(--radius-lg)] border p-3 text-start shadow-sm outline-none focus-visible:ring-2",
                  selected ? "border-primary ring-primary/15 ring-2" : "border-border",
                )}
                onClick={() => selectNode(step.id)}
              >
                <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-[var(--button-radius)]">
                  <Icon aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{step.name}</span>
                  <span className="text-muted-foreground block text-xs">
                    {index + 1}. {labels[step.type]}
                  </span>
                </span>
                <span className="flex shrink-0 gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("extensions.workflows.actions.moveUp")}
                    disabled={index === 0}
                    onClick={(event) => {
                      event.stopPropagation();
                      const next = [...steps];
                      [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                      setSteps(next);
                    }}
                  >
                    <ChevronUpIcon />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("extensions.workflows.actions.moveDown")}
                    disabled={index === steps.length - 1}
                    onClick={(event) => {
                      event.stopPropagation();
                      const next = [...steps];
                      [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
                      setSteps(next);
                    }}
                  >
                    <ChevronDownIcon />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("extensions.workflows.actions.remove")}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSteps(steps.filter(({ id }) => id !== step.id));
                    }}
                  >
                    <Trash2Icon />
                  </Button>
                </span>
              </button>
            </div>
          );
        })}

        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" className="self-start" />}>
            <PlusIcon />
            {t("extensions.workflows.actions.addStep")}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {(["agent", "command", "approval"] as const).map((type) => {
              const Icon = STEP_ICONS[type];
              return (
                <DropdownMenuItem
                  key={type}
                  onClick={() => {
                    const step = createStep(type, labels[type]);
                    setSteps([...steps, step]);
                    selectNode(step.id);
                  }}
                >
                  <Icon />
                  {labels[type]}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
