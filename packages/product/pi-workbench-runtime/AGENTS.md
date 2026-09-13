# Node product tools and policy

Own Workbench-specific tools, prompts, interaction rules, Todo state, inline extension preparation,
default selection/order, bundled Skills/Prompts, built-in package registration and deployment.
SDK sessions/models/resource loading and generic PTY/workspace operations remain with their owners.
Receive collaborators via WorkbenchToolDependencies and session composition; never import React,
frontend product composition, pi-runtime-server, session registries or StreamHub.
Keep tool/extension IDs, schemas, prompts, trace order, output budgets, cancellation, enablement and
persisted formats stable. Use the installed Pi SDK public APIs and truncation/offload behavior.

Use one src/<tool-name>/ directory per custom tool; colocate its implementation, private helpers,
and attribution. Todo state and its MIT license belong in src/rpiv-todo. Pi registration and lifecycle wiring live in resources/extensions/<name>/index.ts; tool execution
and shared projections stay in src. Shared tool assembly lives in src/tool-runtime. Only genuinely
shared helpers belong in lib. Keep src/lib at one subdirectory maximum. resources/ is reserved
for Pi resource kinds (currently extensions, skills and prompts), never a tool name or license category.
The /tools and /tools/builtin-tools entries must not aggregate bash; apps inject the shared
terminal session manager through /tools/bash. Generic Terminal packages must not depend on Pi.

Tool snapshots use the shared tool-resources allowlist, never the whole product package. Preserve
.builtin and artifact root paths; remove only explicitly retired official snapshots and retain unknown
files. Moving files does not authorize changes to bundled instructions or user data. No UI tests.

Product extension resources may be exported directly from resources/extensions/<name>/index.ts.
Keep their TypeScript in the product typecheck and dependency closure checks. Static injection remains
the only activation route; do not additionally enable discovered copies.

Browser execution belongs in src/browser, registration in resources/extensions/browser, and the
only browser-use Skill source in resources/skills/browser-use. Generic browser-server/contracts
remain independent. Preserve the generated Browser package identity and filters; do not also add
Browser inline or copy its Skill to the ordinary .builtin Skill directory.
