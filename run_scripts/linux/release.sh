#!/usr/bin/env bash

set -Eeuo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."
pnpm release:build
exec pnpm release:upload "$@"
