import { createHash } from "node:crypto";

import type {
  FlowEdge,
  FlowNode,
  FlowRevision,
  WorkflowDocument,
  WorkflowValidationIssue,
  WorkflowValidationResult,
} from "@/runtime/shared/execution";
import { parseExecutionDocument } from "./execution-schema";

export interface CompiledExecutionPlan {
  revision: FlowRevision;
  nodes: ReadonlyMap<string, FlowNode>;
  incoming: ReadonlyMap<string, readonly FlowEdge[]>;
  outgoing: ReadonlyMap<string, readonly FlowEdge[]>;
  topologicalOrder: readonly string[];
  startNodeId: string;
  endNodeId: string;
}

function issue(
  code: WorkflowValidationIssue["code"],
  message: string,
  path: string,
  details: Pick<WorkflowValidationIssue, "nodeId" | "edgeId"> = {},
): WorkflowValidationIssue {
  return { code, message, path, ...details };
}

function validateBinding(
  node: FlowNode,
  nodes: ReadonlyMap<string, FlowNode>,
  issues: WorkflowValidationIssue[],
): void {
  const binding =
    node.type === "condition"
      ? node.config.binding
      : node.type === "agent" || node.type === "command" || node.type === "approval"
        ? node.config.input
        : node.type === "end"
          ? node.config.output
          : undefined;
  if (!binding) return;
  if (!binding.path.startsWith("/") && binding.path !== "") {
    issues.push(
      issue(
        "invalid-binding",
        "Binding path must be an RFC 6901 JSON Pointer.",
        `/graph/nodes/${node.id}/config`,
        {
          nodeId: node.id,
        },
      ),
    );
  }
  if (binding.source === "node-output" && (!binding.nodeId || !nodes.has(binding.nodeId))) {
    issues.push(
      issue(
        "invalid-binding",
        "Node-output binding must reference an existing node.",
        `/graph/nodes/${node.id}/config`,
        {
          nodeId: node.id,
        },
      ),
    );
  }
  if (binding.source === "run-input" && binding.nodeId !== undefined) {
    issues.push(
      issue(
        "invalid-binding",
        "Run-input binding cannot include nodeId.",
        `/graph/nodes/${node.id}/config`,
        {
          nodeId: node.id,
        },
      ),
    );
  }
}

export function validateExecutionDocument(value: unknown): WorkflowValidationResult {
  let document: WorkflowDocument;
  try {
    document = parseExecutionDocument(value);
  } catch (error) {
    return {
      valid: false,
      issues: [
        issue(
          "invalid-schema",
          error instanceof Error ? error.message : "Workflow document is invalid.",
          "/",
        ),
      ],
    };
  }

  const issues: WorkflowValidationIssue[] = [];
  if (!document.name.trim()) {
    issues.push(issue("invalid-schema", "Workflow name cannot be empty.", "/name"));
  }
  const agents = new Map<string, (typeof document.agents)[number]>();
  for (const agent of document.agents) {
    if (!agent.name.trim()) {
      issues.push(issue("invalid-node-config", "Agent name cannot be empty.", "/agents"));
    }
    if (agents.has(agent.id)) {
      issues.push(issue("invalid-schema", "Agent IDs must be unique.", "/agents"));
    } else {
      agents.set(agent.id, agent);
    }
  }
  const nodes = new Map<string, FlowNode>();
  for (const node of document.graph.nodes) {
    if (!node.name.trim()) {
      issues.push(
        issue("invalid-node-config", "Node name cannot be empty.", "/graph/nodes", {
          nodeId: node.id,
        }),
      );
    }
    if (
      (node.type === "agent" && !agents.has(node.config.agentId)) ||
      (node.type === "command" && !node.config.command.trim()) ||
      (node.type === "approval" && !node.config.message.trim())
    ) {
      issues.push(
        issue(
          "invalid-node-config",
          node.type === "agent"
            ? "Agent node must reference an existing workflow agent."
            : `${node.type} configuration cannot be empty.`,
          "/graph/nodes",
          { nodeId: node.id },
        ),
      );
    }
    if (nodes.has(node.id)) {
      issues.push(
        issue("duplicate-node-id", "Node IDs must be unique.", "/graph/nodes", {
          nodeId: node.id,
        }),
      );
    } else {
      nodes.set(node.id, node);
    }
  }

  const starts = document.graph.nodes.filter(({ type }) => type === "start");
  const ends = document.graph.nodes.filter(({ type }) => type === "end");
  if (starts.length === 0)
    issues.push(issue("missing-start", "A flow needs one Start node.", "/graph/nodes"));
  if (starts.length > 1)
    issues.push(issue("multiple-start", "A flow can only have one Start node.", "/graph/nodes"));
  if (ends.length === 0)
    issues.push(issue("missing-end", "A flow needs one End node.", "/graph/nodes"));
  if (ends.length > 1)
    issues.push(issue("multiple-end", "A flow can only have one End node.", "/graph/nodes"));

  const edgeIds = new Set<string>();
  const outgoing = new Map<string, FlowEdge[]>();
  const incoming = new Map<string, FlowEdge[]>();
  for (const id of nodes.keys()) {
    outgoing.set(id, []);
    incoming.set(id, []);
  }
  for (const edge of document.graph.edges) {
    if (edgeIds.has(edge.id)) {
      issues.push(
        issue("duplicate-edge-id", "Edge IDs must be unique.", "/graph/edges", {
          edgeId: edge.id,
        }),
      );
    }
    edgeIds.add(edge.id);
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source || !target) {
      issues.push(
        issue("dangling-edge", "Edge endpoints must reference existing nodes.", "/graph/edges", {
          edgeId: edge.id,
        }),
      );
      continue;
    }
    if (source.type === "condition") {
      if (edge.sourceHandle !== "true" && edge.sourceHandle !== "false") {
        issues.push(
          issue(
            "invalid-edge-port",
            "Condition edges require a true or false port.",
            "/graph/edges",
            {
              edgeId: edge.id,
            },
          ),
        );
      }
    } else if (edge.sourceHandle !== undefined) {
      issues.push(
        issue(
          "invalid-edge-port",
          "Only Condition nodes expose named output ports.",
          "/graph/edges",
          {
            edgeId: edge.id,
          },
        ),
      );
    }
    outgoing.get(edge.source)!.push(edge);
    incoming.get(edge.target)!.push(edge);
  }

  for (const node of nodes.values()) validateBinding(node, nodes, issues);

  const indegree = new Map([...nodes.keys()].map((id) => [id, incoming.get(id)!.length]));
  const queue = [...indegree].filter(([, count]) => count === 0).map(([id]) => id);
  const topologicalOrder: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    topologicalOrder.push(id);
    for (const edge of outgoing.get(id) ?? []) {
      const remaining = indegree.get(edge.target)! - 1;
      indegree.set(edge.target, remaining);
      if (remaining === 0) queue.push(edge.target);
    }
  }
  if (topologicalOrder.length !== nodes.size) {
    issues.push(issue("cycle", "Flows must be acyclic.", "/graph/edges"));
  }

  if (starts.length === 1) {
    const reachable = new Set<string>();
    const pending = [starts[0]!.id];
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const edge of outgoing.get(id) ?? []) pending.push(edge.target);
    }
    for (const node of nodes.values()) {
      if (!reachable.has(node.id)) {
        issues.push(
          issue("unreachable-node", "Every node must be reachable from Start.", "/graph/nodes", {
            nodeId: node.id,
          }),
        );
      }
    }
  }

  if (document.kind === "sop") {
    for (const node of nodes.values()) {
      if (!["start", "end", "agent", "command", "approval"].includes(node.type)) {
        issues.push(
          issue(
            "invalid-sop",
            "SOP only supports Agent, Command, and Approval steps.",
            "/graph/nodes",
            {
              nodeId: node.id,
            },
          ),
        );
      }
      const inCount = incoming.get(node.id)?.length ?? 0;
      const outCount = outgoing.get(node.id)?.length ?? 0;
      if (
        (node.type === "start" && (inCount !== 0 || outCount !== 1)) ||
        (node.type === "end" && (inCount !== 1 || outCount !== 0)) ||
        (node.type !== "start" && node.type !== "end" && (inCount !== 1 || outCount !== 1))
      ) {
        issues.push(
          issue("invalid-sop", "SOP steps must form one linear path.", "/graph/edges", {
            nodeId: node.id,
          }),
        );
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function executableGraph(document: WorkflowDocument): WorkflowDocument["graph"] {
  return {
    nodes: document.graph.nodes.map((node) => ({ ...node, position: { x: 0, y: 0 } })),
    edges: document.graph.edges,
    editor: {},
  };
}

export function executionRevisionIdForDocument(document: WorkflowDocument): string {
  const content = canonicalize({
    schemaVersion: document.schemaVersion,
    workflowId: document.id,
    kind: document.kind,
    scope: document.scope,
    name: document.name,
    description: document.description,
    agents: document.agents,
    graph: executableGraph(document),
    concurrency: document.concurrency,
  });
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

/** Computes the v2 identity so a published definition can be migrated without a false conflict. */
export function legacyExecutionRevisionIdForDocument(
  document: WorkflowDocument,
  triggers: unknown,
): string {
  const content = canonicalize({
    schemaVersion: 2,
    workflowId: document.id,
    kind: document.kind,
    scope: document.scope,
    name: document.name,
    description: document.description,
    agents: document.agents,
    graph: executableGraph(document),
    concurrency: document.concurrency,
    triggers,
  });
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

export function compileExecutionDocument(
  value: unknown,
  publishedAt = Date.now(),
): CompiledExecutionPlan {
  const validation = validateExecutionDocument(value);
  if (!validation.valid) {
    const error = new TypeError(validation.issues.map(({ message }) => message).join(" "));
    Object.assign(error, { validation });
    throw error;
  }
  const document = parseExecutionDocument(value);
  const revisionId = executionRevisionIdForDocument(document);
  const revision: FlowRevision = {
    schemaVersion: 3,
    revisionId,
    workflowId: document.id,
    kind: document.kind,
    scope: document.scope,
    name: document.name,
    ...(document.description === undefined ? {} : { description: document.description }),
    agents: document.agents,
    graph: executableGraph(document),
    concurrency: document.concurrency,
    publishedAt,
  };
  const nodes = new Map(revision.graph.nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, FlowEdge[]>([...nodes.keys()].map((id) => [id, []]));
  const outgoing = new Map<string, FlowEdge[]>([...nodes.keys()].map((id) => [id, []]));
  for (const edge of revision.graph.edges) {
    incoming.get(edge.target)!.push(edge);
    outgoing.get(edge.source)!.push(edge);
  }
  const indegree = new Map([...nodes.keys()].map((id) => [id, incoming.get(id)!.length]));
  const queue = [...indegree].filter(([, count]) => count === 0).map(([id]) => id);
  const topologicalOrder: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    topologicalOrder.push(id);
    for (const edge of outgoing.get(id)!) {
      const next = indegree.get(edge.target)! - 1;
      indegree.set(edge.target, next);
      if (next === 0) queue.push(edge.target);
    }
  }
  return {
    revision,
    nodes,
    incoming,
    outgoing,
    topologicalOrder,
    startNodeId: revision.graph.nodes.find(({ type }) => type === "start")!.id,
    endNodeId: revision.graph.nodes.find(({ type }) => type === "end")!.id,
  };
}

export function compileExecutionRevision(revision: FlowRevision): CompiledExecutionPlan {
  const plan = compileExecutionDocument(
    {
      schemaVersion: 3,
      id: revision.workflowId,
      kind: revision.kind,
      scope: revision.scope,
      name: revision.name,
      ...(revision.description === undefined ? {} : { description: revision.description }),
      agents: revision.agents,
      graph: revision.graph,
      concurrency: revision.concurrency,
      draftRevision: 0,
      publishedRevisionId: revision.revisionId,
      createdAt: revision.publishedAt,
      updatedAt: revision.publishedAt,
    },
    revision.publishedAt,
  );
  return { ...plan, revision: { ...plan.revision, revisionId: revision.revisionId } };
}
