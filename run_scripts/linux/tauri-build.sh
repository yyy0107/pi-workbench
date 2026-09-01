#!/usr/bin/env bash

set -Eeuo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."
pnpm install --frozen-lockfile --prod=false
pnpm build
pnpm --filter @workbench/desktop-tauri tauri:build
