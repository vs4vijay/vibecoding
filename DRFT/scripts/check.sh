#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
drft_load_config

drft_section "Checking shell syntax and line endings"
while IFS= read -r -d '' file; do
  bash -n "$file"
  if LC_ALL=C grep -q $'\r' "$file"; then drft_die "CRLF found in Unix-executed file: ${file#"${DRFT_REPO_ROOT}"/}"; fi
done < <(find "$DRFT_REPO_ROOT/scripts" -type f -name '*.sh' -print0)
if LC_ALL=C grep -q $'\r' "$DRFT_REPO_ROOT/config/versions.env"; then drft_die "CRLF found in config/versions.env"; fi

if command -v shellcheck >/dev/null 2>&1; then
  find "$DRFT_REPO_ROOT/scripts" -type f -name '*.sh' -print0 | xargs -0 shellcheck -e SC1091
else
  drft_warn "shellcheck not installed; syntax checks still completed"
fi

drft_section "Checking workflow YAML"
if command -v ruby >/dev/null 2>&1; then
  ruby -e 'require "yaml"; ARGV.each { |f| YAML.parse_file(f) }' "$DRFT_REPO_ROOT"/.github/workflows/*.yml
elif command -v yq >/dev/null 2>&1; then
  yq eval-all 'true' "$DRFT_REPO_ROOT"/.github/workflows/*.yml >/dev/null
else
  drft_warn "ruby/yq unavailable; workflow YAML parse skipped"
fi

drft_log "All lightweight checks passed"
