# @workbench/execution-server

Environment-specific server contracts shared by the Workbench Execution engine and concrete Agent
Runtime adapters.

Public entry points are deliberately limited:

- `./node-executor` owns the node execution context, result, executor port, and registry;
- `./errors` owns stable Execution domain errors projected by server transports.

This package may depend on Execution contracts and generic server support. It must not import a
concrete Agent Runtime, application composition code, Next.js, React, or UI extensions. Pi supplies
its node executors from `@workbench/agent-runtime-pi-server` through the application composition
root.
