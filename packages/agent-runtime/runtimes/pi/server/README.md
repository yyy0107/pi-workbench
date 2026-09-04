# `@workbench/agent-runtime-pi-server`

Pi's Node-side Workbench Runtime implementation. This package owns Pi sessions, resources, models, stream
projection, and Pi-specific HTTP/RPC transport. It implements Workbench-owned ports from
`@workbench/agent-runtime-server`; the Workbench application remains the composition root that
selects Pi and injects Host settings, terminal, Automation, and Execution services.

The package intentionally has no root barrel and exposes only four bounded entry points:

- `./installation` — Runtime installation and application composition bindings;
- `./http` — modern RPC and streaming-download HTTP boundaries;
- `./websocket` — the no-server Pi stream gateway;
- `./legacy` — compatibility endpoints used by the old `/api/pi/*` routes.

Production consumers use the public entries above and the ownership described in the
[Pi Runtime architecture](../README.md). They must not import through `@/*` or private `./src/*`
paths. Internal Workbench packages are source-first workspace dependencies and are bundled into the
Web and Runtime artifacts; they are never desktop Runtime externals.
