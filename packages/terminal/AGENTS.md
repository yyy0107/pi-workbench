# Terminal package boundaries

This directory owns the Terminal capability as three leaf packages. Keep the ownership and direction
below intact when changing this slice.

- `terminal-contracts` owns only serializable Terminal contracts and has no production dependencies.
- `terminal-client` may depend only on `terminal-contracts` and `@workbench/runtime-transport-client`. Its socket-facing inputs use
  generic `sessionId` values; a Pi extension maps its own identity at composition time.
- `terminal-server` owns PTY/session lifecycle, gateway, Tree-sitter policy, `node-pty`, `tree-sitter`, and
  `tree-sitter-bash`. It must not import Pi, React, or Host authentication framing. Host-side
  authentication and authorization must complete before the outer composition root attaches the
  Terminal gateway.
- Pi SDK integration lives in `../product/pi-workbench-runtime/src/bash/index.ts`; the three Terminal packages remain
  independent of the Pi SDK.

The shared Runtime artifact producer gets `node-pty`, `tree-sitter`, and `tree-sitter-bash` from
`@workbench/terminal-server` and confines their physical package roots to the repository-local pnpm
virtual store. Electron consumes that admitted native tree; it must not rebuild it. Do not
reintroduce root compatibility declarations for those packages. See `terminal-server/README.md` for the
resolver boundary. Do not add a root Terminal re-export shim or duplicate the moved runtime sources.
