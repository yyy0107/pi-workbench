# `@workbench/agent-runtime-pi-server`

Pi's Node-side Workbench adapter. This package owns Pi sessions, resources, models, stream
projection, and Pi-specific HTTP/RPC transport. It implements Workbench-owned ports from
`@workbench/agent-runtime-server`; the Workbench application remains the composition root that
selects Pi and injects Host settings, terminal, Automation, and Execution services.

The package intentionally has no root barrel and exposes only four bounded entry points:

- `./installation` — adapter installation and application composition bindings;
- `./http` — modern RPC and streaming-download HTTP boundaries;
- `./websocket` — the no-server Pi stream gateway;
- `./legacy` — compatibility endpoints used by the old `/api/pi/*` routes.

Production code must not import from the Workbench repository through `@/*`, from `./src/*`, or
from the removed `runtime/pi/server` tree. Internal Workbench packages are source-first workspace
dependencies and are bundled into Next.js and the Electron custom server; they are never desktop
runtime externals.
