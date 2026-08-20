#!/usr/bin/env bash

set -uo pipefail

mode="${1:-}"
input="$(cat)"

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$repo_root" || exit 1

log_file="$repo_root/.git/codex-hooks.log"
stamp_file="$repo_root/.git/codex-hooks-quality.stamp"
failure_stamp_file="$repo_root/.git/codex-hooks-failure.stamp"

log() {
  local message="$1"
  printf '[%s] [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$mode" "$message" >>"$log_file"
  printf '[codex-hook:%s] %s\n' "$mode" "$message" >&2
}

allow() {
  if [[ "$mode" == "stop" ]]; then
    printf '{}\n'
  fi
}

block() {
  local message="$1"
  log "BLOCKED: $message"

  if [[ "$mode" == "pre-commit" ]]; then
    printf '%s\n' "$message" >&2
    exit 2
  fi

  if [[ -n "${diff_fingerprint:-}" ]]; then
    printf '%s\n' "$diff_fingerprint" >"$failure_stamp_file"
  fi

  if [[ "$(jq -r '.stop_hook_active // false' <<<"$input" 2>/dev/null)" == "true" ]]; then
    jq -cn --arg message "$message" \
      '{continue:false,stopReason:$message,systemMessage:$message}'
  else
    jq -cn --arg message "$message" \
      '{decision:"block",reason:$message,systemMessage:$message}'
  fi
  exit 0
}

if [[ "$mode" != "stop" && "$mode" != "pre-commit" ]]; then
  block "Unknown project gate mode: $mode"
fi

if [[ "$mode" == "pre-commit" ]]; then
  shell_command="$(jq -r '.tool_input.command // .command // empty' <<<"$input" 2>/dev/null)"
  if [[ ! "$shell_command" =~ (^|[\;\&\|][[:space:]]*)git[[:space:]]+commit([[:space:]]|$) ]]; then
    allow
    exit 0
  fi
fi

collect_changed_files() {
  if [[ "$mode" == "pre-commit" ]]; then
    git diff --cached --name-only -z --diff-filter=ACMRD
  else
    git diff HEAD --name-only -z --diff-filter=ACMRD
    git ls-files --others --exclude-standard -z
  fi
}

mapfile -d '' -t raw_changed_files < <(collect_changed_files)
declare -A seen_files=()
changed_files=()

for file in "${raw_changed_files[@]}"; do
  [[ -n "$file" && "$file" != .codex/* ]] || continue
  [[ -z "${seen_files[$file]+present}" ]] || continue
  seen_files["$file"]=1
  changed_files+=("$file")
done

if ((${#changed_files[@]} == 0)); then
  log "No relevant changed files; skipped."
  allow
  exit 0
fi

fingerprint() {
  if [[ "$mode" == "pre-commit" ]]; then
    git diff --cached --binary -- "${changed_files[@]}"
  else
    git diff HEAD --binary -- "${changed_files[@]}"
    for file in "${changed_files[@]}"; do
      if ! git ls-files --error-unmatch -- "$file" >/dev/null 2>&1; then
        printf '\0untracked:%s\0' "$file"
        sha256sum -- "$file"
      fi
    done
  fi | sha256sum | awk '{print $1}'
}

diff_fingerprint="$(fingerprint)"

if [[ "$mode" == "stop" && "$(jq -r '.stop_hook_active // false' <<<"$input" 2>/dev/null)" == "true" ]]; then
  failed_fingerprint=""
  [[ -f "$failure_stamp_file" ]] && failed_fingerprint="$(<"$failure_stamp_file")"
  if [[ "$failed_fingerprint" == "$diff_fingerprint" ]]; then
    message="Quality gate is still failing and the working diff is unchanged; stopping without repeating checks."
    log "$message"
    jq -cn --arg message "$message" \
      '{continue:false,stopReason:$message,systemMessage:$message}'
    exit 0
  fi
fi

is_lint_file() {
  [[ "$1" =~ \.(cjs|js|jsx|mjs|ts|tsx)$ ]]
}

is_format_file() {
  [[ "$1" =~ \.(cjs|css|html|js|jsx|json|jsonc|md|mdx|mjs|scss|ts|tsx|yaml|yml)$ ]]
}

is_application_file() {
  [[ "$1" =~ \.(cjs|css|js|jsx|json|mjs|ts|tsx)$ ]] || [[ "$1" == package.json || "$1" == pnpm-lock.yaml ]]
}

is_sensitive_file() {
  local file="$1"
  [[ "$file" == package.json || "$file" == pnpm-lock.yaml || "$file" == next.config.* ]] ||
    [[ "$file" == app/api/* || "$file" == runtime/*/server/* ]] ||
    [[ "$file" =~ (^|/)(auth|security|trust|permission|secret|middleware)([^/]*)(/|\.|$) ]]
}

lint_files=()
format_files=()
application_files=()
sensitive_files=()

for file in "${changed_files[@]}"; do
  [[ -f "$file" ]] && is_lint_file "$file" && lint_files+=("$file")
  [[ -f "$file" ]] && is_format_file "$file" && format_files+=("$file")
  is_application_file "$file" && application_files+=("$file")
  is_sensitive_file "$file" && sensitive_files+=("$file")
done

run_security_check() {
  ((${#sensitive_files[@]} > 0)) || return 0

  log "Security-sensitive changes detected in ${#sensitive_files[@]} file(s)."
  local diff_file
  diff_file="$(mktemp "${TMPDIR:-/tmp}/codex-security-diff.XXXXXX")" || return 1

  if [[ "$mode" == "pre-commit" ]]; then
    git diff --cached --unified=0 -- "${sensitive_files[@]}" >"$diff_file"
  else
    git diff HEAD --unified=0 -- "${sensitive_files[@]}" >"$diff_file"
    for file in "${sensitive_files[@]}"; do
      if ! git ls-files --error-unmatch -- "$file" >/dev/null 2>&1; then
        git diff --no-index --unified=0 /dev/null "$file" >>"$diff_file" 2>/dev/null || true
      fi
    done
  fi

  local findings
  findings="$(
    sed -n '/^+++ /d; s/^+//p' "$diff_file" |
      rg -n -i \
        -e 'BEGIN [A-Z ]*PRIVATE KEY' \
        -e "(api[_-]?key|client[_-]?secret|password|access[_-]?token)[ \\t]*[:=][ \\t]*[\"'][^\"']{8,}" \
        -e "NODE_TLS_REJECT_UNAUTHORIZED[ \\t]*=[ \\t]*[\"']?0" \
        -e 'dangerouslySetInnerHTML|(^|[^[:alnum:]_])eval[ \t]*\(|new[ \t]+Function[ \t]*\('
  )"
  local scan_status=$?
  unlink "$diff_file"

  if ((scan_status > 1)); then
    return 1
  fi

  if [[ -n "$findings" ]]; then
    printf '%s\n' "$findings" >&2
    return 1
  fi

  for file in "${sensitive_files[@]}"; do
    if [[ "$file" == package.json || "$file" == pnpm-lock.yaml ]]; then
      log "Dependency manifest changed; running production dependency audit."
      pnpm audit --prod --audit-level high >&2 || return 1
      break
    fi
  done

  log "Security checks passed."
}

run_quality_gate() {
  log "Quality gate started for ${#changed_files[@]} changed file(s)."
  local failed=0

  if ((${#lint_files[@]} > 0)); then
    log "Running oxlint on ${#lint_files[@]} changed code file(s)."
    pnpm exec oxlint "${lint_files[@]}" >&2 || failed=1
  fi

  if ((${#format_files[@]} > 0)); then
    log "Checking formatting on ${#format_files[@]} changed file(s)."
    pnpm exec oxfmt --check "${format_files[@]}" >&2 || failed=1
  fi

  mapfile -t test_files < <(rg --files -g '*.test.ts' -g '*.test.tsx' -g '*.spec.ts' -g '*.spec.tsx' | sort)
  if ((${#application_files[@]} > 0 && ${#test_files[@]} > 0)); then
    log "Running ${#test_files[@]} Node test file(s)."
    node --no-warnings=ExperimentalWarning \
      --import ./.codex/hooks/register-typescript-loader.mjs \
      --test "${test_files[@]}" >&2 || failed=1
  fi

  run_security_check || failed=1
  ((failed == 0)) || return 1

  printf '%s\n' "$diff_fingerprint" >"$stamp_file"
  [[ ! -f "$failure_stamp_file" ]] || unlink "$failure_stamp_file"
  log "Quality gate passed."
}

cached_fingerprint=""
[[ -f "$stamp_file" ]] && cached_fingerprint="$(<"$stamp_file")"

if [[ "$mode" == "pre-commit" && "$cached_fingerprint" == "$diff_fingerprint" ]]; then
  log "Quality gate unchanged; reused prior successful result."
else
  run_quality_gate || block "Quality gate failed. Fix the reported test, lint, formatting, or security issue before continuing."
fi

if [[ "$mode" == "pre-commit" ]]; then
  log "Running staged diff validation."
  git diff --cached --check >&2 || block "Staged diff validation failed."

  if ((${#application_files[@]} > 0)); then
    log "Running final Next.js production build."
    pnpm build >&2 || block "Final production build failed."
  fi

  log "Pre-commit validation passed."
fi

allow
