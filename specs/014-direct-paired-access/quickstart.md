# Quickstart: Direct Paired Mobile Access

This guide defines the implementation checkpoints and release evidence for the account-free LAN/Tailscale topology. Commands use pnpm. It does not authorize UI/DOM/Hook render tests, UI interaction smoke, publication, deployment, or artifact upload.

## 1. Confirm the active Speckit feature

```bash
.specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks
```

Expected feature directory:

```text
specs/014-direct-paired-access
```

## 2. Baseline and migration invariants

Record the existing dirty worktree before edits and preserve unrelated changes. Confirm:

- Pi Runtime remains loopback-only.
- Mobile has no direct dependency on Pi, Runtime, Electron, desktop UI/Shell, or Toolbox.
- The current Spec 013 HPKE vectors, command allowlist, projection sanitizers, operation ledger, replay/snapshot, and mobile storage tests pass before migration.
- No UI/DOM/Hook test or UI interaction smoke is introduced.

## 3. Contract and address-policy checkpoint

Run the protocol, client, and direct-server package tests after direct frame types/codecs, endpoint grammar, pairing transcripts, and challenge authentication are implemented:

```bash
pnpm --filter @workbench/remote-control-contracts typecheck
pnpm --filter @workbench/remote-control-contracts test
pnpm --filter @workbench/remote-control-client typecheck
pnpm --filter @workbench/remote-control-client test
pnpm --filter @workbench/remote-control-direct-server typecheck
pnpm --filter @workbench/remote-control-direct-server test
```

Required proof includes private/Tailscale/public endpoint classification, QR/manual pairing, attempt/expiry/race handling, challenge replay/stale revision/revocation, strict budgets, and identity pinning.

## 4. Desktop gateway checkpoint

```bash
pnpm --filter @workbench/pi-runtime-remote-control typecheck
pnpm --filter @workbench/pi-runtime-remote-control test
node --test apps/desktop-electron/test/remote-control-lifecycle.test.cjs
node --check apps/desktop-electron/src/desktop-remote-control.cjs
node --check apps/desktop-electron/src/main.cjs
```

Required proof:

- disabled means no listener;
- selected exact interface addresses bind all-or-nothing;
- listener replacement and shutdown are idempotent;
- encrypted installation/config/phone authorization persistence precedes visible success;
- renderer IPC never carries keys, secrets, ciphertext, Runtime connection data, paths, or raw errors;
- Runtime generation replacement preserves one Pi owner, changes epoch, and forces synchronization;
- every business frame is reauthorized and the existing closed command/projection boundary remains intact.

## 5. Mobile account-free checkpoint

```bash
pnpm --filter @workbench/mobile typecheck
pnpm --filter @workbench/mobile test
pnpm mobile:expo-check
pnpm mobile:doctor
```

Required proof:

- app boots with no OIDC/Relay environment variables and has no signed-out state;
- QR and manual host/port/code pairing both reach the same confirmed authorization state;
- endpoint priority/fallback never bypasses the pinned computer identity;
- incoming decrypt/projection processing remains serialized;
- background closes connections and foreground recovers via cursor/snapshot/operation status;
- dependencies contain no OAuth/auth-session, Relay client, push/notifications, Pi, Runtime, desktop UI/Shell, or Toolbox.

## 6. Formal direct closed loop

The repository integration harness must start a real loopback instance of the Electron-owned direct WebSocket adapter in test mode and exercise the production mobile transport, direct-server pairing/authentication, Pi desktop frame processor/command adapter, and SQLite operation ledger. Loopback is a deterministic harness substitute for a LAN/Tailscale interface, not a product default.

```bash
node scripts/run-typescript-tests.mjs scripts/remote-control-direct-closed-loop.integration.test.ts
```

The suite must cover:

1. disabled gateway rejects connection;
2. QR pairing and desktop safety confirmation;
3. manual host/port/code pairing and confirmation;
4. authenticated catalog/history reads;
5. create/send/stop/rename/pin/archive with one effect;
6. forced disconnect plus cursor/snapshot/operation recovery;
7. endpoint identity mismatch with zero reads/mutations;
8. revoke closes one device while another remains usable;
9. listener replacement/disable closes old sockets;
10. no account/Relay/provider is started or injected.

## 7. Privacy and dependency checkpoint

```bash
pnpm check:remote-control-boundaries
node --test scripts/check-remote-control-boundaries.test.mjs
node --test scripts/remote-control-privacy-audit.test.mjs
```

Scans must reject account/OIDC/token/Relay/PostgreSQL/push references in the target mobile/desktop product graph and continue rejecting Toolbox, terminal, file, browser, extension, model/provider, tool, approval, raw Pi/Runtime, credentials, keys, ciphertext, paths, prompts, and tool data across the wrong boundary.

## 8. Static UI review

Review code only, without starting Browser/Electron UI or adding/running UI tests:

- Desktop settings reuse the existing settings item, shared controls, semantic tokens, theme, density, and radius behavior.
- Mobile uses existing app palette, safe areas, Dynamic Type defaults, translated labels, accessible roles/live status, and 44-point touch targets.
- Remote enablement, port/interface validation, listener failure, QR/manual modes, safety code, identity mismatch, stale/offline, and revoke/reset warnings are localized in `en-US` and `zh-CN`.
- No login, account, Relay, notification, or excluded capability entry remains visible.

## 9. Production build checkpoint

```bash
pnpm mobile:export:production
pnpm mobile:android-release
pnpm --filter @workbench/desktop-electron run pack:artifact
```

Verify that the mobile production bundle contains no OIDC/Relay endpoints or test secrets, and that the packaged Electron direct gateway includes `ws`, address policy, pairing/authentication, HPKE frame processing, and the operation ledger without unresolved workspace imports.

Do not run EAS, Apple/Google signing, store submission, external upload, or deployment as part of this feature.

## 10. Full repository gates

```bash
pnpm lint
pnpm format
pnpm check:workspace-dependencies
pnpm check:package-structure
pnpm typecheck
pnpm build
git diff --check
```

## 11. Explicit physical-device release gates

The following cannot be closed by static or loopback tests and must remain explicitly unexecuted until an authorized release process runs them:

- QR/manual pairing comprehension on real iOS and Android phones;
- iOS local-network prompt and Android cleartext/local-network behavior;
- OS firewall prompts and selected-interface behavior on Linux/macOS/Windows;
- real Wi-Fi/Ethernet transitions, DHCP address changes, IPv4/IPv6 LAN reachability;
- real Tailscale IPv4, IPv6, single-label MagicDNS, `.ts.net`, reconnect, and disconnected states;
- phone background/suspension/termination and foreground recovery;
- screen-reader, Dynamic Type, touch target, light/dark theme, density, and localization review;
- production p95 latency and reference-device memory/render timing;
- independent cryptographic/security assessment.
