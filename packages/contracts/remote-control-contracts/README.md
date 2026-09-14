# @workbench/remote-control-contracts

[中文](README.zh-CN.md) · [Packages](../../README.md) · [Spec014](../../../specs/014-direct-paired-access/plan.md)

Versioned, JSON-safe contracts for the narrow Workbench mobile remote-control surface. This package owns account-free direct pairing and challenge metadata, encrypted mobile–desktop payload shapes, strict codecs, protocol limits, cursors, and stable errors. It has no React, Pi RPC, Runtime transport, or server dependency.

The current direct topology is tracked by Spec014; Spec013 is retained only as superseded implementation history. Direct product code uses `@workbench/remote-control-contracts/protocol`, `/codecs`, `/direct-crypto`, and `/direct-pairing`. The root entry and `/pairing` expose shared business and pairing shapes. `/crypto` and `/legacy-codecs` exist only for compatibility with the superseded Spec013 wire and must not be imported by the mobile or direct-gateway production graph.

## Scope

The closed v1 command union contains session create, text send, stop, rename, set pinned, archive, and ordinary-question answer only. There is no terminal, file, browser, Git, attachment, arbitrary tool invocation, tool approval, extension, toolbox, automation, model/provider setting, archive restore/delete, raw Runtime/Pi RPC, or catch-all method entry. The read-only conversation union separately carries user-visible assistant text, canonical tool-call arguments, and original textual tool output; those values cannot be replayed as commands.

The main limits are 16 KiB for socket authentication, 256 KiB for a sealed envelope, 128 KiB for command plaintext, 64 KiB for submitted text, 96 KiB for projected assistant text, 64 KiB for tool arguments, 128 KiB for textual tool output, 512 bytes for a title, 128 ASCII bytes for an ID, 4 KiB for error details, 2 KiB for a legacy activity summary, 192 KiB/100 items for a catalog page, 192 KiB/50 items for a history page, 16 KiB for a live delta, and JSON depth 16. Limits use UTF-8 bytes and apply to complete structured values; projected messages and tool transcripts explicitly report truncation.

Direct endpoints are closed `{kind, host, port}` values for private LAN or Tailscale reachability. Socket URLs are derived by the direct-gateway/client owners, always use `/remote/v1/direct`, and carry no credential or query. QR/manual pairing, fresh signed challenges, device authorization revisions, and direct envelope headers contain no account, OAuth/OIDC, Relay, ticket, or bearer-token field.

The `/direct-crypto` entry implements the E2EE gate with RFC 9180 authenticated mode using P-256, HKDF-SHA256, and AES-256-GCM. `/direct-pairing` owns the canonical direct pairing and socket-authentication transcripts plus the six-digit safety-code derivation. Every visible direct envelope header is authenticated as AAD; expiry, direction, device/machine identity, and recipient-key rotation are checked by the boundary owners.

## Ownership and lifecycle

This package owns wire compatibility only. It has no process, socket, database, UI, account, Tailscale control-plane, or credential lifecycle. Callers must parse untrusted values at the boundary and must not add open-ended `method`/`payload` shapes. Cursors use decimal uint64 strings. The account-free direct product is foreground-active only and makes no central push-delivery promise.

Replay retains up to 10,000 events, 10 MiB, and 15 minutes in the desktop owner. Snapshot chunks hold at most 50 sessions and 192 KiB. Socket owners cap pending bytes at 1 MiB and treat ten seconds of sustained pressure as a slow consumer. These policies are implemented by their owning packages, while this package owns their shared shapes and primitive limits.

## Validation

```bash
pnpm --filter @workbench/remote-control-contracts typecheck
pnpm --filter @workbench/remote-control-contracts test
```
