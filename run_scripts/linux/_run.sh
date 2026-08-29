#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
APP_PORT="${PORT:-3000}"
NEXT_DEV_LOCK="${PROJECT_ROOT}/.next/dev/lock"

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

next_dev_lock_pids() {
  [[ -e "${NEXT_DEV_LOCK}" ]] || return 0

  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -t -- "${NEXT_DEV_LOCK}" 2>/dev/null | sort -u || true
    return
  fi

  if command -v fuser >/dev/null 2>&1; then
    fuser "${NEXT_DEV_LOCK}" 2>/dev/null | tr ' ' '\n' | sed '/^$/d' | sort -u || true
    return
  fi

  echo "Error: lsof or fuser is required to inspect the Next.js development lock." >&2
  return 1
}

workbench_dev_watcher_pids() {
  local process_directory pid command_line

  for process_directory in /proc/[0-9]*; do
    [[ -r "${process_directory}/cmdline" ]] || continue
    pid="${process_directory##*/}"
    [[ "${pid}" != "$$" ]] || continue
    command_line="$(tr '\0' ' ' <"${process_directory}/cmdline" 2>/dev/null)" || continue
    if [[ "${command_line}" == *"tsx/dist/cli.mjs watch "* ]] &&
      [[ "${command_line}" == *"${PROJECT_ROOT}/server.ts --dev"* ]]; then
      echo "${pid}"
    fi
  done | sort -u
}

workbench_electron_dev_pids() {
  local process_directory pid command_line process_cwd

  for process_directory in /proc/[0-9]*; do
    [[ -r "${process_directory}/cmdline" ]] || continue
    pid="${process_directory##*/}"
    [[ "${pid}" != "$$" ]] || continue
    process_cwd="$(readlink -f "${process_directory}/cwd" 2>/dev/null)" || continue
    [[ "${process_cwd}" == "${PROJECT_ROOT}" ]] || continue
    command_line="$(tr '\0' ' ' <"${process_directory}/cmdline" 2>/dev/null)" || continue
    if [[ "${command_line}" == *"/electron/dist/electron . "* ]] &&
      [[ "${command_line}" != *" --type="* ]]; then
      echo "${pid}"
    fi
  done | sort -u
}

signal_process_trees() {
  local signal="$1"
  shift
  local own_pgid pid pgid target
  local -a targets=()
  declare -A seen=()

  own_pgid="$(ps -o pgid= -p "$$" | tr -d '[:space:]')"
  for pid in "$@"; do
    [[ "${pid}" =~ ^[0-9]+$ ]] || continue
    pgid="$(ps -o pgid= -p "${pid}" 2>/dev/null | tr -d '[:space:]')"
    if [[ "${pgid}" =~ ^[0-9]+$ ]] && ((10#${pgid} > 1)) && [[ "${pgid}" != "${own_pgid}" ]]; then
      target="-${pgid}"
    else
      target="${pid}"
    fi
    [[ -n "${seen[${target}]:-}" ]] && continue
    seen["${target}"]=1
    targets+=("${target}")
  done

  ((${#targets[@]} == 0)) || kill "-${signal}" -- "${targets[@]}" 2>/dev/null || true
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
  signal_process_trees TERM "${pids[@]}"

  for _ in {1..70}; do
    sleep 0.1
    pid_output="$(listener_pids "${port}")" || return 1
    [[ -z "${pid_output}" ]] && return
  done

  mapfile -t pids <<<"${pid_output}"
  echo "> Port ${port} is still occupied; force-stopping process(es): ${pids[*]}"
  signal_process_trees KILL "${pids[@]}"
  sleep 0.2

  pid_output="$(listener_pids "${port}")" || return 1
  if [[ -n "${pid_output}" ]]; then
    echo "Error: port ${port} could not be released; remaining process(es): ${pid_output//$'\n'/ }." >&2
    return 1
  fi
}

release_processes() {
  local label="$1"
  local finder="$2"
  local pid_output
  local -a pids

  pid_output="$("${finder}")" || return 1
  [[ -n "${pid_output}" ]] || return 0

  mapfile -t pids <<<"${pid_output}"
  echo "> Stopping ${label}: ${pids[*]}"
  signal_process_trees TERM "${pids[@]}"

  for _ in {1..70}; do
    sleep 0.1
    pid_output="$("${finder}")" || return 1
    [[ -z "${pid_output}" ]] && return
  done

  mapfile -t pids <<<"${pid_output}"
  echo "> ${label} did not stop; forcing: ${pids[*]}"
  signal_process_trees KILL "${pids[@]}"
  sleep 0.2

  pid_output="$("${finder}")" || return 1
  if [[ -n "${pid_output}" ]]; then
    echo "Error: ${label} are still running: ${pid_output//$'\n'/ }." >&2
    return 1
  fi
}

release_next_dev_lock() {
  release_processes "stale Next.js development lock holder(s)" next_dev_lock_pids
}

release_workbench_dev_watchers() {
  release_processes "stale Workbench development watcher(s)" workbench_dev_watcher_pids
}

release_workbench_electron_dev() {
  release_processes "stale Pi Workbench Electron development instance(s)" workbench_electron_dev_pids
}

workbench_server_is_healthy() {
  local port="$1"
  node -e '
    const { isWorkbenchServer } = require(process.argv[1]);
    isWorkbenchServer(process.argv[2], { timeoutMs: 10_000 }).then((healthy) => {
      process.exitCode = healthy ? 0 : 1;
    });
  ' "${PROJECT_ROOT}/electron/server-probe.cjs" "http://127.0.0.1:${port}"
}

prepare_electron_dev_server() {
  local port="$1"
  local pid_output

  echo "> Checking for an existing Workbench development server on port ${port}"
  if workbench_server_is_healthy "${port}"; then
    echo "> Reusing the healthy Workbench development server on port ${port}"
    return
  fi

  # An Electron process can hold the single-instance lock before its server becomes ready. Stop
  # only development main processes launched from this repository; healthy instances returned
  # above and packaged applications are never touched.
  release_workbench_electron_dev

  pid_output="$(listener_pids "${port}")" || return 1
  if [[ -n "${pid_output}" ]]; then
    echo "> Port ${port} is occupied by an unhealthy process; cleaning up its process tree"
    release_port "${port}"
  fi

  # A failed Next child leaves `tsx watch` alive without a listener or lock. It would otherwise
  # respawn on the next source edit and race the server owned by the new Electron process.
  release_workbench_dev_watchers
  release_next_dev_lock

  # A watcher can briefly respawn after its listening child exits. Recheck after releasing the
  # repository lock so Electron never races a replacement Next.js process.
  pid_output="$(listener_pids "${port}")" || return 1
  if [[ -n "${pid_output}" ]]; then
    echo "> Port ${port} was reclaimed by a stale watcher; cleaning it up"
    release_port "${port}"
  fi
  echo "> Workbench development startup is clear on port ${port}"
}

main() {
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
      prepare_electron_dev_server "${APP_PORT}"
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
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
