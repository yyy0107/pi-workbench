# Validation guide

Use pnpm and the installed SDK 0.85.1. Run commands from the repository root. Do not execute root `pnpm test` or whole-package UI scripts: they include excluded UI tests.

1. Resolve SpecKit feature: `bash .specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks`.
2. Run the exact node:test file set in non-ui-tests.json with `node --import ./scripts/register-typescript-test-loader.mjs --test <files>`. The list is reviewed after migrations; do not blindly glob all tests. Material icon maps and core workspace state are pure tests; DOM download/picker and render/Hook tests are moved/reviewed but not run.
3. Run focused package `pnpm --filter <owner> --filter <consumer> typecheck` during each migration, then `pnpm typecheck` at integration.
4. Run `pnpm check:workspace-dependencies`, `pnpm check:package-structure`, and exact root architecture/checker tests. Check new core closures, old entrypoint absence, declared deps and cycles.
5. Run `pnpm lint`, `pnpm build`, and `pnpm install --offline --frozen-lockfile --ignore-scripts` once manifests/lock are synchronized. If offline metadata is absent, record the necessary normal install and then repeat frozen validation.
6. Record source mappings, before/after metrics and test/build results in validation.md. Verify `git diff --check` and preserve pre-existing skill modifications.

Expected: 96 libraries; no forbidden dependencies or old migration forwards; original persisted documents/events/IDs preserved; non-UI tests, types, lint, structure and builds pass. Unverified UI rendering/interaction is explicitly recorded. See contracts/public-boundaries.md for lifecycle and behavior invariants.
