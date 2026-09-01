# Terminal server native dependency ownership

`@workbench/terminal-server` is the sole production owner of `node-pty`, `tree-sitter`, and
`tree-sitter-bash`. Electron staging resolves all three from this leaf's manifest, requires their
physical package roots to remain inside the repository-local pnpm virtual store, rebuilds
`node-pty`, and stages/prunes the exact target `tree-sitter` and `tree-sitter-bash` prebuilds.

The former root compatibility declarations were removed after focused resolver, source-provenance,
native materialization, and target-drift tests proved this leaf-owned path. Do not add a second root
native dependency owner.
