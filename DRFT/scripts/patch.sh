#!/usr/bin/env bash
# Apply DRFT patches on top of the extracted upstream tree.
#
# Layout:
#   patches/focus-android/*.patch  → applied at ${FOCUS_MODULE_PATH}, -p1
#   patches/components/*.patch     → applied at mobile/android/android-components, -p1
#   patches/tree/*.patch           → applied at the repo root, -p1 (Gecko/etc.)
#
# Patches are applied in lexicographic order. Number them like `0001-foo.patch`
# to control sequencing.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
drft_load_config

DRY_RUN=0
REVERSE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)  DRY_RUN=1 ;;
    --reverse)  REVERSE=1 ;;  # Useful when iterating on patches locally
    -h|--help)
      cat >&2 <<EOF
Usage: $0 [--dry-run] [--reverse]

Applies every *.patch under patches/ to the extracted source tree.
  --dry-run   Run patch with --dry-run; no files modified.
  --reverse   Reverse-apply (undo) all patches.
EOF
      exit 0 ;;
    *) drft_die "unknown argument: $1" ;;
  esac
  shift
done

if [ ! -d "${DRFT_SRC_DIR}" ]; then
  drft_die "source tree missing; run scripts/fetch.sh first"
fi

STAMP="patches-applied"
if [ "${DRY_RUN}" -eq 0 ] && [ "${REVERSE}" -eq 0 ] && drft_stamp_exists "${STAMP}"; then
  drft_log "Patches already applied (stamp present). Re-run scripts/fetch.sh --force to reset."
  exit 0
fi

# Map patch directory → target dir inside the upstream tree. Anything added
# here works the same way: drop .patch files in, they get applied.
declare -A PATCH_TARGETS=(
  ["focus-android"]="${FOCUS_MODULE_PATH}"
  ["components"]="mobile/android/android-components"
  ["tree"]="."
)

# Order of keys matters: tree-wide patches first (deepest changes), then
# components, then focus-android (most local).
PATCH_ORDER=("tree" "components" "focus-android")

apply_one_dir() {
  local subdir="$1" target_rel="$2"
  local patch_dir="${DRFT_PATCHES_DIR}/${subdir}"
  local target_abs="${DRFT_SRC_DIR}/${target_rel}"

  [ -d "${patch_dir}" ] || return 0
  # Collect *.patch files in lexicographic order.
  local files=()
  while IFS= read -r -d '' f; do
    files+=("$f")
  done < <(find "${patch_dir}" -maxdepth 1 -name '*.patch' -print0 | sort -z)

  [ "${#files[@]}" -gt 0 ] || return 0

  if [ ! -d "${target_abs}" ]; then
    drft_die "patch target dir does not exist in source tree: ${target_rel}"
  fi

  drft_section "Applying ${#files[@]} patch(es) from patches/${subdir} → ${target_rel}"

  local patch_args=("-p1" "--no-backup-if-mismatch")
  [ "${DRY_RUN}" -eq 1 ] && patch_args+=("--dry-run")
  [ "${REVERSE}" -eq 1 ] && patch_args+=("--reverse")

  for f in "${files[@]}"; do
    drft_log "  $(basename "$f")"
    (cd "${target_abs}" && patch "${patch_args[@]}" < "$f") \
      || drft_die "patch failed: $f"
  done
}

for key in "${PATCH_ORDER[@]}"; do
  apply_one_dir "${key}" "${PATCH_TARGETS[$key]}"
done

if [ "${DRY_RUN}" -eq 0 ] && [ "${REVERSE}" -eq 0 ]; then
  drft_stamp_set "${STAMP}"
fi
drft_log "Patches done."
