import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { finished } from "node:stream/promises";

import type { CommandNode } from "@workbench/execution-contracts";
import { ExecutionError } from "@workbench/execution-server/errors";
import type {
  ExecutionNodeContext,
  ExecutionNodeExecutor,
  ExecutionNodeResult,
} from "@workbench/execution-server/node-executor";
import { bashCommandPolicy } from "@/runtime/terminal/server/bash-command-policy";
import {
  getToolTerminalSessionManager,
  type ToolTerminalSessionManager,
} from "@/runtime/terminal/server/tool-terminal-session-manager";

const MAX_INLINE_COMMAND_OUTPUT_BYTES = 1024 * 1024;

export interface WorkbenchCommandExecutionNodeExecutorOptions {
  isWorkspaceTrusted(workspacePath: string): boolean;
  terminal?: ToolTerminalSessionManager;
}

function resolveCommandCwd(
  workspaceId: string,
  workspacePath: string,
  relativeCwd: string | undefined,
): string {
  const cwd = path.resolve(workspacePath, relativeCwd?.trim() || ".");
  const relative = path.relative(workspacePath, cwd);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ExecutionError(
      "cwd-outside-workspace",
      "Command working directory must remain inside the execution workspace.",
      { workspaceId, relativeCwd: relativeCwd ?? "." },
    );
  }
  return cwd;
}

export class WorkbenchCommandExecutionNodeExecutor implements ExecutionNodeExecutor {
  private readonly isWorkspaceTrusted: WorkbenchCommandExecutionNodeExecutorOptions["isWorkspaceTrusted"];
  private readonly terminal: ToolTerminalSessionManager;

  constructor(options: WorkbenchCommandExecutionNodeExecutorOptions) {
    this.isWorkspaceTrusted = options.isWorkspaceTrusted;
    this.terminal = options.terminal ?? getToolTerminalSessionManager();
  }

  async execute(context: ExecutionNodeContext): Promise<ExecutionNodeResult> {
    const node = context.node as CommandNode;
    if (!this.isWorkspaceTrusted(context.workspacePath)) {
      throw new ExecutionError(
        "workspace-not-trusted",
        "The execution target workspace is not trusted.",
        { workspaceId: context.workspaceId },
      );
    }
    const cwd = resolveCommandCwd(
      context.workspaceId,
      context.workspacePath,
      node.config.relativeCwd,
    );
    const policy = bashCommandPolicy.normalize(node.config.command);
    if (policy.action === "reject") {
      throw new ExecutionError("command-rejected", "The command was rejected by Bash policy.", {
        runId: context.runId,
        nodeId: node.id,
        reason: policy.reason ?? "policy-rejected",
      });
    }
    await mkdir(context.artifactDirectory, { recursive: true, mode: 0o700 });
    const artifactId = randomUUID();
    const artifactPath = path.join(context.artifactDirectory, `${artifactId}.log`);
    const artifactStream = createWriteStream(artifactPath, { mode: 0o600 });
    const artifactFinished = finished(artifactStream);
    const chunks: Buffer[] = [];
    let inlineSize = 0;
    let totalSize = 0;
    let result: Awaited<ReturnType<ToolTerminalSessionManager["execute"]>> | undefined;
    let executionError: unknown;
    try {
      result = await this.terminal.execute({
        sessionId: context.runId,
        toolCallId: `${node.id}-${context.attempt}`,
        command: policy.command,
        cwd,
        signal: context.signal,
        timeout: (node.config.timeoutSeconds ?? policy.timeoutSeconds ?? 600) * 1_000,
        ...(context.input === undefined ? {} : { initialInput: JSON.stringify(context.input) }),
        onData(data) {
          artifactStream.write(data);
          totalSize += data.byteLength;
          if (inlineSize >= MAX_INLINE_COMMAND_OUTPUT_BYTES) return;
          const remaining = MAX_INLINE_COMMAND_OUTPUT_BYTES - inlineSize;
          const next = data.subarray(0, remaining);
          chunks.push(next);
          inlineSize += next.byteLength;
        },
      });
    } catch (error) {
      executionError = error;
    } finally {
      artifactStream.end();
      await artifactFinished;
    }
    const artifact =
      totalSize > MAX_INLINE_COMMAND_OUTPUT_BYTES
        ? {
            id: artifactId,
            name: `${node.name || node.id}.log`,
            mediaType: "text/plain",
            size: totalSize,
          }
        : undefined;
    if (!artifact) await unlink(artifactPath).catch(() => undefined);
    if (executionError !== undefined) {
      if (artifact && typeof executionError === "object" && executionError !== null) {
        Object.assign(executionError, { artifact });
      }
      throw executionError;
    }
    if (!result) throw new Error("Command execution ended without a result.");
    if (result.exitCode !== 0) {
      const error = new Error(`Command exited with code ${String(result.exitCode)}.`);
      Object.assign(error, {
        code: "command-nonzero-exit",
        exitCode: result.exitCode,
        ...(artifact ? { artifact } : {}),
      });
      throw error;
    }
    return {
      exitCode: result.exitCode ?? undefined,
      ...(artifact ? { artifact } : {}),
      output: {
        exitCode: result.exitCode ?? -1,
        output: Buffer.concat(chunks).toString("utf8"),
        truncated: totalSize > MAX_INLINE_COMMAND_OUTPUT_BYTES,
      },
    };
  }
}
