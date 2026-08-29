import type { FlowNode } from "@/runtime/shared/execution";

type NamedWorkflowNode = Pick<FlowNode, "name" | "type">;

function numberedNameIndex(name: string, typeLabel: string): number | undefined {
  if (!name.startsWith(typeLabel)) return undefined;
  const suffix = name.slice(typeLabel.length).trim();
  if (!/^[1-9]\d*$/u.test(suffix)) return undefined;

  const index = Number(suffix);
  return Number.isSafeInteger(index) ? index : undefined;
}

export function nextWorkflowNodeName(
  nodes: readonly NamedWorkflowNode[],
  type: FlowNode["type"],
  typeLabel: string,
): string {
  let sameTypeCount = 0;
  let highestNamedIndex = 0;

  for (const node of nodes) {
    if (node.type !== type) continue;
    sameTypeCount += 1;
    highestNamedIndex = Math.max(highestNamedIndex, numberedNameIndex(node.name, typeLabel) ?? 0);
  }

  return `${typeLabel} ${Math.max(sameTypeCount, highestNamedIndex) + 1}`;
}
