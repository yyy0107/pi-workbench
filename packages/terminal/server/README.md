# Terminal server native dependency ownership

`@workbench/terminal-server` is the sole production owner of `node-pty`, `tree-sitter`, and
`tree-sitter-bash`. The Runtime artifact producer resolves all three from this leaf's manifest and
requires their physical package roots to remain inside the repository-local pnpm virtual store.
Normal local builds may materialize the current upstream `node-pty` prebuild. Release CI runs
`pnpm --filter @workbench/terminal-server native:pty:build` on the matching native Runner and sets
`WORKBENCH_NODE_PTY_NATIVE_BUILD_MANIFEST`; the Runtime producer then requires every staged
`node-pty` byte and mode to match that source-build manifest before pruning compiler inputs and
non-target variants.

Electron and Tauri consume the same admitted Node-API files and run the shared native Runtime smoke
under their actual Node/Electron executable. Neither consumer invokes `electron-rebuild`,
`node-gyp`, or stages `node-addon-api`. Published applications therefore carry the verified native
files and do not require an end-user C/C++ toolchain.

The former root compatibility declarations were removed after focused resolver, source-provenance,
native materialization, and target-drift tests proved this leaf-owned path. Do not add a second root
native dependency owner.
