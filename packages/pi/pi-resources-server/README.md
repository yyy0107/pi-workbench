# @workbench/pi-resources-server

src owns resource catalogs, Skills/Extensions/Packages/prompts, settings/trust and workspace protocol services, persistence and mutation/reload coordination. lib supplies consumed path, parsing, naming, file-reading, update metadata and resource enablement helpers; src resource services consume them. Both keep TS with at most one subdirectory. Session access, installed tools, shared cache selection and publication are explicitly chosen in the server resource-composition adapters. Resource sources live at resources/ and are copied using the same artifact paths. Pure helper tests live in tests/; full service and host integration tests remain in pi/server/tests.

Source layout: src owns this capability and its contracts; lib contains consumed internal helpers; tests live at the package root. Example consumer: `src/extension-name.ts` imports `lib/extension-name.ts`. Capability and helper code remains TS/TSX; existing build tooling retains its language.

Workspace protocol adaptation stays here, but the directory store now belongs to @workbench/workspace-server/catalog; DTOs and operation ports come from agent-runtime-contracts/workspace-catalog. The old workspace-store export is removed. Pi server composition owns host event projection.
