# @workbench/remote-control-direct-server

[中文](README.zh-CN.md) · [Packages](../../README.md) · [Spec014](../../../specs/014-direct-paired-access/plan.md)

Reusable, embedded direct-gateway capability for Workbench Remote. Electron main owns concrete network listeners and supplies local encrypted persistence plus the current bounded Pi remote frame processor. The package owns private/Tailscale endpoint policy, account-free pairing, paired-device challenge authentication, strict socket sequencing, limits, replay protection, and revocation-aware business dispatch.

It does not own Electron, Pi/Runtime, React/UI, Tailscale integration, account/OIDC, PostgreSQL, push delivery, public discovery, NAT traversal, or a deployed Relay.

Only explicitly selected RFC1918/IPv6 ULA or Tailscale CGNAT/IPv6/MagicDNS-style endpoints are eligible. The socket URL is credential-free `ws://<host>:<port>/remote/v1/direct`; application HPKE protects pairing and business content even when the transport is plain WebSocket. The listener remains disabled by default, authenticates a fresh signed device challenge before dispatch, and applies bounded frames, backpressure, replay, authorization-revision, and revocation checks.

Pairing invitations expire after two minutes and are single-use. The phone submits a base-mode HPKE encrypted claim; the desktop and phone display the same six-digit safety code, and no authorization is returned until a person confirms it on the desktop. Later connections require a fresh P-256 signed challenge and the persisted authorization revision before any business frame. A revoked device's active sockets are closed immediately.

The gateway accepts at most 32 total connections and 8 per source address. Authentication frames are capped at 16 KiB and sealed frames at 256 KiB. Output that would exceed the 1 MiB socket backlog is rejected immediately; a send that remains backpressured for ten seconds also closes the slow consumer. Pairing claims receive at most five attempts. Errors and diagnostics are bounded and redact secrets, challenges, codes, key material, and ciphertext.

The public source entries are explicit in `package.json`. There is no catch-all RPC surface: Toolbox, terminal, files, browser, extensions, model/provider settings, arbitrary tool approval, and raw Runtime/Pi RPC are forbidden. Implementation and verification are tracked by `specs/014-direct-paired-access/tasks.md`.

## Validation

```bash
pnpm --filter @workbench/remote-control-direct-server typecheck
pnpm --filter @workbench/remote-control-direct-server test
```
