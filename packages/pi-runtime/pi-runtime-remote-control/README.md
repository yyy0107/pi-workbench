# @workbench/pi-runtime-remote-control

[中文](README.zh-CN.md) · [Packages](../../README.md) · [Spec014](../../../specs/014-direct-paired-access/plan.md)

Electron-main-safe adapter from the deliberately narrow direct mobile protocol to the existing loopback-only Pi Runtime. It owns the mobile-safe session/conversation projection, exhaustive command mapping, per-device durable operation identity, replay/snapshot state, and authenticated HPKE frame processing through injected ports. It does not own network listeners and does not import Electron or private Pi server modules.

## Public surface and lifecycle

The root entry aggregates explicit `/conversation-projection`, `/command-adapter`, `/operation-ledger`, `/operation-service`, `/runtime-monitor`, `/projection`, `/session-catalog`, `/snapshot-service`, `/frame-processor`, `/direct-frame-processor`, `/sqlite-ledger`, and `/workspace-projection` entries. Consumers must use these exports instead of package internals.

Electron main creates one processor for the current loopback Runtime generation. Runtime replacement disposes the old generation and creates a fresh projection epoch. The embedded direct gateway authenticates a paired phone first, then passes only a sealed direct envelope and its current local authorization to `direct-frame-processor`. Every read and mutation rechecks machine, device, authorization revision, action scope, and revocation around the local effect.

The direct frame processor opens and seals RFC 9180 authenticated-mode HPKE envelopes using P-256, HKDF-SHA256, and AES-256-GCM. It serves only the closed catalog/history/status/recovery requests, executes the allowlisted command union through the durable ledger, and encrypts each result/event for one authorized phone. The Runtime monitor consumes public Pi connection and stream APIs and projects only bounded mobile-safe state; it does not emit push notifications.

The operation ledger records a canonical command digest and fixed domain identity before invoking Pi. Exact retries replay the result; conflicting content under the same operation ID is rejected. Completed records retain seven days and at least the latest 10,000; incomplete records are not capacity-pruned. The replay ring retains at most 10,000 events, 10 MiB, and 15 minutes. Snapshots use at most 50 sessions/192 KiB per chunk and a 1,000-event/1 MiB concurrent buffer.

Only session list/read/create, text send, stop, rename, pin, archive, and answering an already-pending ordinary question are mapped through public Pi RPC. The read projection preserves every user-visible assistant text message plus bounded, non-interactive tool-call arguments and original textual tool output. Oversized UTF-8 content is prefix-truncated with an explicit flag. Hidden thinking, binary/image results, result details, provider exceptions, unknown host events, and approval payloads remain excluded. Toolbox, terminal/file/browser control, arbitrary tool invocation/RPC, sensitive approvals, model/provider settings, extensions, archive restore, and deletion are absent. There is no Workbench account, OAuth/OIDC, central service, public discovery, notification provider, or Tailscale API dependency.

## Validation

```bash
pnpm --filter @workbench/pi-runtime-remote-control typecheck
pnpm --filter @workbench/pi-runtime-remote-control test
```
