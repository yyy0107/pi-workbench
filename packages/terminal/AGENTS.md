# Terminal package boundaries

This directory owns the Terminal capability as four leaf packages. Keep the ownership and direction
below intact when changing this slice.

- `contracts` owns only serializable Terminal contracts and has no production dependencies.
- `client` may depend only on `contracts` and `@workbench/host-client`. Its socket-facing inputs use
  generic `sessionId` values; a Pi extension maps its own identity at composition time.
- `server` owns PTY/session lifecycle, gateway, Tree-sitter policy, `node-pty`, `tree-sitter`, and
  `tree-sitter-bash`. It must not import Pi, React, or Host authentication framing. Host-side
  authentication and authorization must complete before the outer composition root attaches the
  Terminal gateway.
- `pi-tool` is the only Terminal package that may import the public
  `@earendil-works/pi-coding-agent` API. It owns the `interactive-bash-tool` ToolDefinition adapter
  and must not deep-import Pi internals.

The Electron staging/rebuild resolver gets `node-pty`, `tree-sitter`, and `tree-sitter-bash` from
`@workbench/terminal-server` and confines their physical package roots to the repository-local pnpm
virtual store. Do not reintroduce root compatibility declarations for those packages. See
`server/README.md` for the resolver boundary. Do not add a root Terminal re-export shim or duplicate
the moved runtime sources.
