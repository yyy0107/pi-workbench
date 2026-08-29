import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

import {
  type ExecutionThinkingLevel,
  type WorkflowDocument,
  type WorkflowJsonValue,
} from "@/runtime/shared/execution";

const Id = Type.String({ minLength: 1, maxLength: 200 });
const PathSegmentId = Type.String({
  minLength: 1,
  maxLength: 200,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$",
});
// Drafts intentionally allow temporarily incomplete text fields. Publish-time
// semantic validation in FlowCompiler rejects empty names and executor config.
const Name = Type.String({ maxLength: 240 });
const Position = Type.Object(
  { x: Type.Number(), y: Type.Number() },
  { additionalProperties: false },
);
const Binding = Type.Object(
  {
    source: Type.Union([Type.Literal("run-input"), Type.Literal("node-output")]),
    nodeId: Type.Optional(Id),
    path: Type.String({ maxLength: 2_048 }),
  },
  { additionalProperties: false },
);
const NodeBase = {
  id: Id,
  name: Name,
  position: Position,
};
const ThinkingLevel = Type.Union([
  Type.Literal("off"),
  Type.Literal("minimal"),
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
  Type.Literal("xhigh"),
  Type.Literal("max"),
]);

const CommonNodeSchemas = [
  Type.Object(
    { ...NodeBase, type: Type.Literal("start"), config: Type.Object({}) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...NodeBase,
      type: Type.Literal("end"),
      config: Type.Object({ output: Type.Optional(Binding) }, { additionalProperties: false }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...NodeBase,
      type: Type.Literal("command"),
      config: Type.Object(
        {
          command: Type.String({ maxLength: 100_000 }),
          relativeCwd: Type.Optional(Type.String({ maxLength: 2_048 })),
          timeoutSeconds: Type.Optional(Type.Number({ minimum: 1, maximum: 86_400 })),
          input: Type.Optional(Binding),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...NodeBase,
      type: Type.Literal("condition"),
      config: Type.Object(
        {
          binding: Binding,
          operator: Type.Union([
            Type.Literal("equals"),
            Type.Literal("not-equals"),
            Type.Literal("exists"),
            Type.Literal("contains"),
            Type.Literal("greater-than"),
          ]),
          value: Type.Optional(Type.Unknown()),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...NodeBase,
      type: Type.Literal("approval"),
      config: Type.Object(
        {
          message: Type.String({ maxLength: 20_000 }),
          input: Type.Optional(Binding),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
] as const;

const AgentNodeSchema = Type.Object(
  {
    ...NodeBase,
    type: Type.Literal("agent"),
    config: Type.Object(
      {
        agentId: PathSegmentId,
        promptTemplate: Type.Optional(PathSegmentId),
        input: Type.Optional(Binding),
        output: Type.Object({ schema: Type.Unknown() }, { additionalProperties: false }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const LegacyAgentNodeSchema = Type.Object(
  {
    ...NodeBase,
    type: Type.Literal("agent"),
    config: Type.Object(
      {
        prompt: Type.String({ maxLength: 100_000 }),
        input: Type.Optional(Binding),
        model: Type.Optional(
          Type.Object(
            {
              provider: Id,
              modelId: Id,
              thinkingLevel: Type.Optional(ThinkingLevel),
            },
            { additionalProperties: false },
          ),
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const FlowNodeSchema = Type.Union([AgentNodeSchema, ...CommonNodeSchemas]);
const LegacyFlowNodeSchema = Type.Union([LegacyAgentNodeSchema, ...CommonNodeSchemas]);

function graphSchema(nodeSchema: TSchema) {
  return Type.Object(
    {
      nodes: Type.Array(nodeSchema, { maxItems: 2_000 }),
      edges: Type.Array(
        Type.Object(
          {
            id: Id,
            source: Id,
            target: Id,
            sourceHandle: Type.Optional(Type.Union([Type.Literal("true"), Type.Literal("false")])),
          },
          { additionalProperties: false },
        ),
        { maxItems: 10_000 },
      ),
      editor: Type.Object(
        {
          viewport: Type.Optional(
            Type.Object(
              { x: Type.Number(), y: Type.Number(), zoom: Type.Number({ minimum: 0.01 }) },
              { additionalProperties: false },
            ),
          ),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  );
}

const Scope = Type.Union([
  Type.Object({ type: Type.Literal("personal") }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal("project"), workspaceId: Id }, { additionalProperties: false }),
]);
const Concurrency = Type.Union([
  Type.Object({ mode: Type.Literal("queue") }, { additionalProperties: false }),
  Type.Object({ mode: Type.Literal("skip") }, { additionalProperties: false }),
  Type.Object({ mode: Type.Literal("independent") }, { additionalProperties: false }),
  Type.Object(
    {
      mode: Type.Literal("parallel"),
      maxActiveRuns: Type.Integer({ minimum: 1, maximum: 8 }),
    },
    { additionalProperties: false },
  ),
]);
const DocumentBase = {
  id: Id,
  kind: Type.Union([Type.Literal("workflow"), Type.Literal("sop")]),
  scope: Scope,
  name: Name,
  description: Type.Optional(Type.String({ maxLength: 20_000 })),
  concurrency: Concurrency,
  draftRevision: Type.Integer({ minimum: 0 }),
  publishedRevisionId: Type.Optional(Id),
  createdAt: Type.Number({ minimum: 0 }),
  updatedAt: Type.Number({ minimum: 0 }),
  archivedAt: Type.Optional(Type.Number({ minimum: 0 })),
};

export const ExecutionDocumentSchema = Type.Object(
  {
    schemaVersion: Type.Literal(3),
    ...DocumentBase,
    agents: Type.Array(
      Type.Object({ id: PathSegmentId, name: Name }, { additionalProperties: false }),
      { maxItems: 200 },
    ),
    graph: graphSchema(FlowNodeSchema),
  },
  { additionalProperties: false },
);

const PreviousExecutionDocumentSchema = Type.Object(
  {
    schemaVersion: Type.Literal(2),
    ...DocumentBase,
    agents: Type.Array(
      Type.Object({ id: PathSegmentId, name: Name }, { additionalProperties: false }),
      { maxItems: 200 },
    ),
    graph: graphSchema(FlowNodeSchema),
    triggers: Type.Optional(Type.Array(Type.Unknown(), { maxItems: 100 })),
  },
  { additionalProperties: false },
);

const LegacyExecutionDocumentSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    ...DocumentBase,
    graph: graphSchema(LegacyFlowNodeSchema),
    triggers: Type.Optional(Type.Array(Type.Unknown(), { maxItems: 100 })),
  },
  { additionalProperties: false },
);

type SchemaWorkflowDocument = Static<typeof ExecutionDocumentSchema>;
type PreviousWorkflowDocument = Static<typeof PreviousExecutionDocumentSchema>;
type LegacyWorkflowDocument = Static<typeof LegacyExecutionDocumentSchema>;

export interface LegacyWorkflowAgentResource {
  agentId: string;
  prompt: string;
  model?: {
    provider: string;
    modelId: string;
    thinkingLevel?: ExecutionThinkingLevel;
  };
}

export interface ExecutionDocumentParseResult {
  document: WorkflowDocument;
  legacyAgentResources: LegacyWorkflowAgentResource[];
}

function isJsonValue(value: unknown, seen: Set<unknown> = new Set()): value is WorkflowJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, seen))
    : Object.getPrototypeOf(value) === Object.prototype &&
      Object.values(value as Record<string, unknown>).every((entry) => isJsonValue(entry, seen));
  seen.delete(value);
  return valid;
}

function schemaError(schema: TSchema, value: unknown): TypeError {
  const first = Value.Errors(schema, value)[0];
  return new TypeError(first ? `${first.instancePath || "/"}: ${first.message}` : "Invalid value.");
}

function legacyAgentId(nodeId: string, index: number): string {
  const safe = nodeId
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/^[^A-Za-z0-9]+/u, "")
    .slice(0, 150);
  return `${safe || "agent"}-${index + 1}`;
}

function migrateLegacyDocument(value: LegacyWorkflowDocument): ExecutionDocumentParseResult {
  const resources: LegacyWorkflowAgentResource[] = [];
  const agents: WorkflowDocument["agents"] = [];
  let agentIndex = 0;
  const nodes = (value.graph.nodes as Static<typeof LegacyFlowNodeSchema>[]).map((node) => {
    if (node.type !== "agent") return node;
    const agentId = legacyAgentId(node.id, agentIndex);
    agentIndex += 1;
    agents.push({ id: agentId, name: node.name || agentId });
    resources.push({
      agentId,
      prompt: node.config.prompt,
      ...(node.config.model ? { model: node.config.model } : {}),
    });
    return {
      id: node.id,
      type: node.type,
      name: node.name,
      position: node.position,
      config: {
        agentId,
        promptTemplate: "default",
        ...(node.config.input ? { input: node.config.input } : {}),
        output: {
          schema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
            additionalProperties: false,
          },
        },
      },
    };
  });
  const { triggers: _legacyTriggers, ...legacyDocument } = value;
  return {
    document: structuredClone({
      ...legacyDocument,
      schemaVersion: 3,
      agents,
      graph: { ...value.graph, nodes },
    } as WorkflowDocument),
    legacyAgentResources: resources,
  };
}

function migratePreviousDocument(value: PreviousWorkflowDocument): WorkflowDocument {
  const { triggers: _legacyTriggers, ...document } = value;
  return structuredClone({ ...document, schemaVersion: 3 } as WorkflowDocument);
}

function assertDocumentJsonValues(document: WorkflowDocument): void {
  for (const node of document.graph.nodes) {
    if (
      ((node.type === "condition" && node.config.value !== undefined) || node.type === "agent") &&
      !isJsonValue(node.type === "condition" ? node.config.value : node.config.output.schema)
    ) {
      throw new TypeError(`/graph/nodes/${node.id}/config: Expected JSON-serializable data.`);
    }
  }
}

export function parseExecutionDocumentWithMigration(value: unknown): ExecutionDocumentParseResult {
  if (Value.Check(ExecutionDocumentSchema, value)) {
    const document = value as SchemaWorkflowDocument as WorkflowDocument;
    assertDocumentJsonValues(document);
    return { document: structuredClone(document), legacyAgentResources: [] };
  }
  if (Value.Check(PreviousExecutionDocumentSchema, value)) {
    const document = migratePreviousDocument(value as PreviousWorkflowDocument);
    assertDocumentJsonValues(document);
    return { document, legacyAgentResources: [] };
  }
  if (Value.Check(LegacyExecutionDocumentSchema, value)) {
    const migrated = migrateLegacyDocument(value as LegacyWorkflowDocument);
    assertDocumentJsonValues(migrated.document);
    return migrated;
  }
  throw schemaError(ExecutionDocumentSchema, value);
}

export function parseExecutionDocument(value: unknown): WorkflowDocument {
  return parseExecutionDocumentWithMigration(value).document;
}

export function assertExecutionJsonValue(value: unknown, path = "/input"): WorkflowJsonValue {
  if (!isJsonValue(value)) throw new TypeError(`${path}: Expected JSON-serializable data.`);
  return structuredClone(value);
}
