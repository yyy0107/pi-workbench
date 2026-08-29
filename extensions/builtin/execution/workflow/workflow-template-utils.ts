import type { FlowNode, WorkflowDocument } from "@/runtime/shared/execution";

export function createLinearWorkflowGraph(
  document: WorkflowDocument,
  steps: FlowNode[],
): WorkflowDocument {
  const start = document.graph.nodes.find(({ type }) => type === "start")!;
  const end = document.graph.nodes.find(({ type }) => type === "end")!;
  const nodes = [start, ...steps, end].map((node, index) => ({
    ...node,
    position: { x: 80 + index * 220, y: 160 },
  }));
  const agents = new Map(document.agents.map((agent) => [agent.id, agent]));
  for (const node of steps) {
    if (node.type === "agent" && !agents.has(node.config.agentId)) {
      agents.set(node.config.agentId, { id: node.config.agentId, name: node.name });
    }
  }

  return {
    ...document,
    agents: [...agents.values()],
    graph: {
      nodes,
      edges: nodes.slice(0, -1).map((node, index) => ({
        id: `${node.id}-${nodes[index + 1]!.id}`,
        source: node.id,
        target: nodes[index + 1]!.id,
      })),
      editor: {},
    },
  };
}
