import type {
  ExecutionSessionOrigin,
  FlowNode,
  WorkflowJsonValue,
  WorkflowRunEvent,
} from "@/runtime/shared/execution";

export interface ExecutionNodeContext {
  runId: string;
  executionOrigin: ExecutionSessionOrigin;
  node: FlowNode;
  attempt: number;
  workspaceId: string;
  workspacePath: string;
  input?: WorkflowJsonValue;
  signal: AbortSignal;
  sessionDirectory: string;
  artifactDirectory: string;
}

export interface ExecutionNodeResult {
  output?: WorkflowJsonValue;
  sessionId?: string;
  exitCode?: number;
  artifact?: NonNullable<WorkflowRunEvent["artifact"]>;
}

export interface ExecutionNodeExecutor {
  execute(context: ExecutionNodeContext): Promise<ExecutionNodeResult>;
}

export class ExecutionNodeExecutorRegistry {
  private readonly executors = new Map<FlowNode["type"], ExecutionNodeExecutor>();

  constructor(executors: Partial<Record<FlowNode["type"], ExecutionNodeExecutor>> = {}) {
    for (const [type, executor] of Object.entries(executors)) {
      if (executor) this.executors.set(type as FlowNode["type"], executor);
    }
  }

  get(type: FlowNode["type"]): ExecutionNodeExecutor | undefined {
    return this.executors.get(type);
  }

  register(type: FlowNode["type"], executor: ExecutionNodeExecutor): () => void {
    this.executors.set(type, executor);
    return () => {
      if (this.executors.get(type) === executor) this.executors.delete(type);
    };
  }
}
