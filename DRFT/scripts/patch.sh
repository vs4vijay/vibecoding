#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
drft_load_config
DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) printf 'Usage: %s [--dry-run]\n' "$0"; exit 0 ;;
    *) drft_die "unknown argument: $1" ;;
  esac
  shift
done
[ -d "$DRFT_FOCUS_DIR" ] || drft_die "verified source tree missing; run scripts/fetch.sh first"

PATCH_MANIFEST="${DRFT_STATE_DIR}/patches.env"
patch_digest() {
  { printf 'revision=%s\n' "$FIREFOX_REV"; find "$DRFT_PATCHES_DIR" -type f -name '*.patch' -print0 | sort -z | while IFS= read -r -d '' f; do printf '%s\0' "${f#"${DRFT_PATCHES_DIR}"/}"; drft_sha256 "$f"; done; } | if command -v sha256sum >/dev/null; then sha256sum | awk '{print $1}'; else shasum -a 256 | awk '{print $1}'; fi
}
DIGEST="$(patch_digest)"
if [ "$DRY_RUN" -eq 0 ] && [ -f "$PATCH_MANIFEST" ] && grep -q "^patch_digest='$DIGEST'$" "$PATCH_MANIFEST"; then drft_log "Reusing matching patch state"; exit 0; fi
if [ "$DRY_RUN" -eq 0 ] && [ -f "$PATCH_MANIFEST" ]; then drft_die "patch set changed after application; run scripts/fetch.sh --force for an atomic clean reapply"; fi

apply_group() {
  local group="$1" target="$2" f args=(-p1 --batch --forward --no-backup-if-mismatch)
  [ "$DRY_RUN" -eq 1 ] && args+=(--dry-run)
  while IFS= read -r -d '' f; do
    [ -d "$DRFT_SRC_DIR/$target" ] || drft_die "patch target missing: $target"
    drft_log "Applying ${f#"${DRFT_PATCHES_DIR}"/}"
    (cd "$DRFT_SRC_DIR/$target" && patch "${args[@]}" < "$f") || drft_die "patch failed: $f; run scripts/fetch.sh --force to recover"
  done < <(find "$DRFT_PATCHES_DIR/$group" -maxdepth 1 -type f -name '*.patch' -print0 2>/dev/null | sort -z)
}
apply_group tree .
apply_group components mobile/android/android-components
apply_group focus-android "$FOCUS_MODULE_PATH"
if [ "$DRY_RUN" -eq 0 ]; then
  drft_atomic_write "$PATCH_MANIFEST" <<EOF
firefox_rev='$FIREFOX_REV'
patch_digest='$DIGEST'
EOF
fi
drft_log "Patch state verified ($DIGEST)"
