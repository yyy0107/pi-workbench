# Pi application contributions

This directory is the application-owned integration boundary for UI and extension capabilities that
are supplied by the statically selected Pi Agent Runtime. It is deliberately not a workspace
package: the contributions depend on the root Workbench Extension Platform, while the reusable Pi
adapter implementation lives under `packages/agent-runtime/adapters/pi`.

Only this boundary may expose Pi client/protocol modules to the Pi-owned builtin contributions.
Workbench Core, the generic extension set, and the generic application shell must not import these
modules. A future production adapter can provide a sibling contribution bundle without changing the
Core packages.
