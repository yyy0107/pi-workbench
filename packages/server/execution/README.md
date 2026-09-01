# @workbench/execution-server

The complete Workbench-owned Execution server capability: Workflow definition validation and
compilation, repository persistence, run admission/scheduling, approvals, and the concrete Command
node adapter. Concrete Agent Runtime adapters and the application composition root stay outside this
package.

Public entry points are deliberately limited:

- `./errors` owns stable Execution domain errors projected by server transports;
- `./node-executor` owns the node execution context, result, executor port, and registry;
- `./engine`, `./repository`, and `./service` own the Execution runtime core;
- `./terminal-command-executor` is the sole concrete capability edge. It uses the public
  `@workbench/terminal-server` Bash policy and tool-session manager; this package does not declare
  native Terminal dependencies itself.

This package may depend on Execution contracts, generic server support, and Terminal Server. It must
not import a concrete Agent Runtime, Pi SDK/server, application composition code, Next.js, React, or
UI extensions. Pi supplies Agent-node executors and resource catalog bindings through the public
`@workbench/agent-runtime-pi-server` boundary; the Runtime app installs them in
[`apps/runtime-node/src/composition/installed-execution.ts`](../../../apps/runtime-node/src/composition/installed-execution.ts).

Personal workflows continue to use the configured Execution root. Project workflows continue to use
the compatible `<project>/.pi/workflows` on-disk format so existing projects can be read and
migrated. That file-format compatibility is not a Pi package dependency.

`ExecutionService`/`ExecutionEngine` instances are long-lived at the application composition root.
The installed Pi service preserves their repository, engine, registry, queued runs, and active runs
across development rebinds; this leaf must not create a parallel service singleton.

Phase 2 residual: coordinated Execution/Automation shutdown remains an application-lifecycle concern.
This leaf migration deliberately does not change that existing shutdown behavior.
