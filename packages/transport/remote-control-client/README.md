# @workbench/remote-control-client

[中文](README.zh-CN.md) · [Packages](../../README.md) · [Spec014](../../../specs/014-direct-paired-access/plan.md)

Platform-neutral connection and projection state for the Workbench mobile remote client. It owns authentication sequencing, reconnect/backoff, cursor recovery, bounded snapshots, and remote operation tracking through injected ports. Expo and native storage remain app-owned.

## Public surface and lifecycle

Use the root entry for the stable aggregate API, or `/profiles`, `/connection`, `/endpoint-policy`, `/ports`, `/types`, `/conversation`, `/operations`, `/session-management`, `/recovery`, `/synchronization`, and `/cursor` for an explicit owner. The package does not depend on React, React Native, Expo, SQLite, SecureStore, Pi, Electron, or any account/Relay/Tailscale provider.

Each connection profile pins one desktop installation identity and keeps one to eight explicitly approved LAN/Tailscale endpoints in user-controlled priority order. The client derives a credential-free fixed-path `ws://` URL, verifies the pinned identity in a fresh desktop challenge, and sends the paired phone's P-256 proof before any business frame. Resume contains only the last applied cursor and at most 100 unresolved operation IDs. Background/inactive app state suspends the connection; foreground or restored reachability requests one authoritative recovery. Failures use capped full jitter from one to thirty seconds; identity mismatch, revocation, incompatibility, and suspension suppress automatic reconnect.

Events apply only at the exact next cursor. Duplicates are ignored; gaps and epoch changes stop application and require a snapshot. Snapshot completion replaces projection plus base cursor atomically through an injected store. Unknown operation outcomes are queried by the same ID and never automatically resubmitted. A server-confirmed not-found result requires a new explicit user retry.

The retained conversation view is capped at 200 items and local drafts at 64 KiB UTF-8. It retains bounded read-only assistant/tool transcripts, preserves tool calls while live text deltas arrive, and explicitly marks text truncated at the protocol boundary. The prohibited surface includes Toolbox, terminal/file/browser control, tool invocation or approval, extensions, model/provider settings, arbitrary RPC, archive restore, and deletion.

## Validation

```bash
pnpm --filter @workbench/remote-control-client typecheck
pnpm --filter @workbench/remote-control-client test
```
