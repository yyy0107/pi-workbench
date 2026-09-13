# Pi Terminal SDK adapter

This package owns the `interactive-bash-tool` ToolDefinition adapter and may import only the public
`@earendil-works/pi-coding-agent` API, never SDK internals. Keep tool IDs, schemas, approval behavior
and output budgets stable. PTY/session lifecycle and native dependencies belong to
`@workbench/terminal-server`; this package composes that capability without duplicating it.
