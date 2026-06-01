#!/usr/bin/env bash
# Convenience: fetch → patch → build, with sane defaults.
# Use this for the most common case (CI or local one-shot).

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"${SCRIPT_DIR}/fetch.sh"
"${SCRIPT_DIR}/patch.sh"
"${SCRIPT_DIR}/build.sh" "$@"
