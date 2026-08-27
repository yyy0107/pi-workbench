#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
APP_PORT="${PORT:-3000}"

cd "${PROJECT_ROOT}"

if [[ ! "${APP_PORT}" =~ ^[0-9]+$ ]] || ((10#${APP_PORT} < 1 || 10#${APP_PORT} > 65535)); then
  echo "Error: PORT must be an integer from 1 to 65535; received '${APP_PORT}'." >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "Error: pnpm is required but was not found in PATH." >&2
  echo "Install pnpm and run this script again." >&2
  exit 1
fi

echo "> Synchronizing dependencies from pnpm-lock.yaml"
pnpm install --frozen-lockfile --prod=false

listener_pids() {
  local port="$1"

  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null | sort -u || true
    return
  fi

  if command -v fuser >/dev/null 2>&1; then
    fuser "${port}/tcp" 2>/dev/null | tr ' ' '\n' | sed '/^$/d' | sort -u || true
    return
  fi

  echo "Error: lsof or fuser is required to release port ${port}." >&2
  return 1
}

release_port() {
  local port="$1"
  local pid_output
  local -a pids

  pid_output="$(listener_pids "${port}")" || return 1
  if [[ -z "${pid_output}" ]]; then
    echo "> Port ${port} is already available"
    return
  fi

  mapfile -t pids <<<"${pid_output}"
  echo "> Releasing port ${port} from process(es): ${pids[*]}"
  kill -TERM "${pids[@]}" 2>/dev/null || true

  for _ in {1..30}; do
    sleep 0.1
    pid_output="$(listener_pids "${port}")" || return 1
    [[ -z "${pid_output}" ]] && return
  done

  mapfile -t pids <<<"${pid_output}"
  echo "> Port ${port} is still occupied; force-stopping process(es): ${pids[*]}"
  kill -KILL "${pids[@]}" 2>/dev/null || true
  sleep 0.2

  pid_output="$(listener_pids "${port}")" || return 1
  if [[ -n "${pid_output}" ]]; then
    echo "Error: port ${port} could not be released; remaining process(es): ${pid_output//$'\n'/ }." >&2
    return 1
  fi
}

case "${1:-}" in
  web-dev)
    echo "> Starting Web development server"
    exec pnpm dev
    ;;
  web-build)
    release_port "${APP_PORT}"
    echo "> Building Web application"
    pnpm build
    echo "> Starting production Web application on port ${APP_PORT}"
    export NODE_ENV=production
    export PORT="${APP_PORT}"
    exec pnpm start
    ;;
  electron-dev)
    echo "> Synchronizing Electron development assets"
    pnpm predev
    echo "> Starting Electron development application"
    export WORKBENCH_OPEN_DEVTOOLS=1
    exec pnpm electron:dev
    ;;
  electron-build)
    release_port "${APP_PORT}"
    echo "> Building Electron installer for Linux"
    pnpm electron:dist

    package_name="$(node -p "require('./package.json').name")"
    electron_executable="${PROJECT_ROOT}/dist-electron/linux-unpacked/${package_name}"
    if [[ ! -x "${electron_executable}" ]]; then
      echo "Error: packaged Electron executable was not found: ${electron_executable}" >&2
      exit 1
    fi

    echo "> Starting packaged Electron application on port ${APP_PORT}"
    export PORT="${APP_PORT}"
    exec "${electron_executable}"
    ;;
  *)
    echo "Usage: $0 {web-dev|web-build|electron-dev|electron-build}" >&2
    exit 2
    ;;
esac
