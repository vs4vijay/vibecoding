#!/usr/bin/env bash
# Build the Focus APK from the patched source tree.
#
# Defaults to the variant in config/versions.env (DRFT_VARIANT, e.g. focusDebug).
# Override via:   DRFT_VARIANT=focusRelease scripts/build.sh
# Or pass:        scripts/build.sh focusRelease
#
# Outputs are copied to dist/ at the end so they survive a `clean.sh`-on-build/
# and are easy to upload as CI artifacts.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
drft_load_config
drft_check_host_basics
drft_check_jdk
drft_check_android_sdk

VARIANT="${DRFT_VARIANT}"
EXTRA_GRADLE_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)
      cat >&2 <<EOF
Usage: $0 [variant] [-- extra-gradle-args...]

  variant   focus-android build variant (default: \$DRFT_VARIANT = ${DRFT_VARIANT}).
            Examples: focusDebug | focusRelease | focusBeta | focusNightly
                      klarDebug  | klarRelease  | klarBeta  | klarNightly

Anything after a literal '--' is forwarded to gradle, e.g.:
  $0 focusDebug -- --info --stacktrace
EOF
      exit 0 ;;
    --) shift; EXTRA_GRADLE_ARGS=("$@"); break ;;
    -*) drft_die "unknown flag: $1 (use -- to forward gradle args)" ;;
    *)  VARIANT="$1" ;;
  esac
  shift
done

if [ ! -d "${DRFT_FOCUS_DIR}" ]; then
  drft_die "source tree not prepared; run scripts/fetch.sh && scripts/patch.sh first"
fi

# Variant name → gradle assemble task. Focus uses `app:assemble<Variant>`,
# capitalized e.g. focusDebug → assembleFocusDebug.
capitalize_first() { echo "${1^}"; }
ASSEMBLE_TASK="app:assemble$(capitalize_first "${VARIANT}")"

drft_section "Building ${DRFT_PRODUCT_NAME} (variant: ${VARIANT})"
drft_log "Module : ${FOCUS_MODULE_PATH}"
drft_log "Task   : ${ASSEMBLE_TASK}"
drft_log "Source : ${DRFT_FOCUS_DIR}"

# focus-android ships its own gradlew. Use it so we honor the wrapper version
# pinned in the upstream tree.
cd "${DRFT_FOCUS_DIR}"

# --no-daemon: CI-friendly (no leaked daemons between jobs); local builds may
# prefer daemon — set DRFT_USE_GRADLE_DAEMON=1 to opt in.
DAEMON_FLAG="--no-daemon"
if [ "${DRFT_USE_GRADLE_DAEMON:-0}" = "1" ]; then
  DAEMON_FLAG=""
fi

# Ensure gradlew is executable (tarball extraction may drop the +x bit on
# some filesystems / on Windows it doesn't matter but doesn't hurt).
chmod +x ./gradlew 2>/dev/null || true

./gradlew \
  ${DAEMON_FLAG} \
  --stacktrace \
  "${ASSEMBLE_TASK}" \
  "${EXTRA_GRADLE_ARGS[@]}"

# Stage outputs into dist/ for predictable CI artifact upload.
drft_section "Staging artifacts → dist/"
mkdir -p "${DRFT_DIST_DIR}"
OUTPUT_BASE="${DRFT_FOCUS_DIR}/app/build/outputs/apk"
if [ ! -d "${OUTPUT_BASE}" ]; then
  drft_die "expected APK output dir missing: ${OUTPUT_BASE}"
fi

# Find every .apk produced under app/build/outputs/apk and copy to dist/,
# preserving the variant subdir so multiple builds don't clobber each other.
count=0
while IFS= read -r -d '' apk; do
  rel="${apk#${OUTPUT_BASE}/}"
  dest="${DRFT_DIST_DIR}/${rel}"
  mkdir -p "$(dirname "${dest}")"
  cp -f "${apk}" "${dest}"
  drft_log "  $(printf '%s' "${rel}")"
  count=$((count + 1))
done < <(find "${OUTPUT_BASE}" -type f -name '*.apk' -print0)

[ "${count}" -gt 0 ] || drft_die "no APKs produced for variant ${VARIANT}"
drft_log "${count} APK(s) staged in ${DRFT_DIST_DIR}"
