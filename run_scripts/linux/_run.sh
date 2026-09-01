#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

main() {
  cd "${PROJECT_ROOT}"

  if ! command -v pnpm >/dev/null 2>&1; then
    echo "Error: pnpm is required but was not found in PATH." >&2
    echo "Install pnpm and run this script again." >&2
    exit 1
  fi

  echo "> Synchronizing dependencies from pnpm-lock.yaml"
  pnpm install --frozen-lockfile --prod=false

  case "${1:-}" in
    web-dev)
      echo "> Starting Web development server"
      exec pnpm dev
      ;;
    web-build)
      echo "> Building Web application"
      pnpm build
      echo "> Starting production Web application on port ${PORT:-3000}"
      export NODE_ENV=production
      exec pnpm start
      ;;
    electron-dev)
      export WORKBENCH_OPEN_DEVTOOLS=1
      if [[ -n "${WORKBENCH_DESKTOP_RENDERER_ORIGIN:-}" ]]; then
        echo "> Connecting Electron to an existing Desktop renderer"
        exec pnpm electron:dev:connect
      fi
      echo "> Starting the Desktop renderer and Electron; Electron owns Runtime"
      exec pnpm electron:dev
      ;;
    electron-build)
      echo "> Building Electron installer for Linux"
      pnpm electron:dist

      package_name="$(node -p "require('./apps/desktop-electron/package.json').desktopPackageName")"
      electron_executable="${PROJECT_ROOT}/dist-electron/linux-unpacked/${package_name}"
      if [[ ! -x "${electron_executable}" ]]; then
        echo "Error: packaged Electron executable was not found: ${electron_executable}" >&2
        exit 1
      fi

      echo "> Starting packaged Electron application"
      exec "${electron_executable}"
      ;;
    *)
      echo "Usage: $0 {web-dev|web-build|electron-dev|electron-build}" >&2
      exit 2
      ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
