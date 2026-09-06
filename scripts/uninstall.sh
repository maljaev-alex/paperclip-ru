#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
TOOL="$DIR/../tools/paperclip-ru.mjs"
ARGS=("$TOOL" "uninstall")
for argument in "$@"; do
  case "$argument" in
    --version) ARGS+=(--release-version) ;;
    --non-interactive|--yes) ;;
    *) ARGS+=("$argument") ;;
  esac
done
exec node "${ARGS[@]}"
