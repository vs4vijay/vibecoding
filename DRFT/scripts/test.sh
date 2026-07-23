#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
drft_load_config

tmp="$(mktemp -d "${TMPDIR:-/tmp}/drft harness.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
fixture="$tmp/repo with spaces"
mkdir -p "$fixture/config" "$fixture/scripts/lib" "$fixture/patches/focus-android" "$fixture/patches/components" "$fixture/patches/tree" "$fixture/.github/workflows"
cp "$DRFT_REPO_ROOT/config/versions.env" "$fixture/config/versions.env"
cp "$DRFT_REPO_ROOT/scripts/"*.sh "$fixture/scripts/"
cp "$DRFT_REPO_ROOT/scripts/lib/common.sh" "$fixture/scripts/lib/common.sh"
printf 'name: fixture\non: [push]\njobs: {}\n' > "$fixture/.github/workflows/test.yml"

drft_section "Config and CRLF rejection"
cp "$fixture/config/versions.env" "$tmp/good.env"
sed '/FIREFOX_REV=/d' "$tmp/good.env" > "$fixture/config/versions.env"
if DRFT_REPO_ROOT_OVERRIDE="$fixture" bash "$fixture/scripts/check.sh" >"$tmp/error" 2>&1; then drft_die "missing config key was accepted"; fi
grep -q 'FIREFOX_REV' "$tmp/error" || drft_die "missing-key diagnostic was not actionable"
cp "$tmp/good.env" "$fixture/config/versions.env"
printf '#!/usr/bin/env bash\r\ntrue\r\n' > "$fixture/scripts/crlf.sh"
if DRFT_REPO_ROOT_OVERRIDE="$fixture" bash "$fixture/scripts/check.sh" >"$tmp/error" 2>&1; then drft_die "CRLF script was accepted"; fi
grep -q 'CRLF found' "$tmp/error" || drft_die "CRLF diagnostic was not actionable"
rm "$fixture/scripts/crlf.sh"

drft_section "Fetch manifest reuse and invalidation"
archive_root="$tmp/archive/firefox-fixture/mobile/android/focus-android"
mkdir -p "$archive_root"
printf 'fixture\n' > "$archive_root/README"
tar -czf "$tmp/source.tar.gz" -C "$tmp/archive" firefox-fixture
DRFT_REPO_ROOT_OVERRIDE="$fixture" DRFT_SOURCE_ARCHIVE="$tmp/source.tar.gz" bash "$fixture/scripts/fetch.sh"
DRFT_REPO_ROOT_OVERRIDE="$fixture" DRFT_SOURCE_ARCHIVE="$tmp/does-not-exist" bash "$fixture/scripts/fetch.sh"
rm -rf "$fixture/build/firefox-src/mobile/android/focus-android"
if DRFT_REPO_ROOT_OVERRIDE="$fixture" DRFT_SOURCE_ARCHIVE="$tmp/does-not-exist" bash "$fixture/scripts/fetch.sh" >"$tmp/error" 2>&1; then drft_die "missing source directory was reused"; fi
DRFT_REPO_ROOT_OVERRIDE="$fixture" DRFT_SOURCE_ARCHIVE="$tmp/source.tar.gz" bash "$fixture/scripts/fetch.sh"

drft_section "Patch order, empty set, and invalidation"
DRFT_REPO_ROOT_OVERRIDE="$fixture" bash "$fixture/scripts/patch.sh"
printf '%s\n' '--- a/README' '+++ b/README' '@@ -1 +1 @@' '-fixture' '+patched' > "$fixture/patches/focus-android/0001-fixture.patch"
if DRFT_REPO_ROOT_OVERRIDE="$fixture" bash "$fixture/scripts/patch.sh" >"$tmp/error" 2>&1; then drft_die "changed patch set was reused"; fi
grep -q 'patch set changed' "$tmp/error" || drft_die "patch invalidation diagnostic missing"
DRFT_REPO_ROOT_OVERRIDE="$fixture" DRFT_SOURCE_ARCHIVE="$tmp/source.tar.gz" bash "$fixture/scripts/fetch.sh" --force
DRFT_REPO_ROOT_OVERRIDE="$fixture" bash "$fixture/scripts/patch.sh"
grep -q patched "$fixture/build/firefox-src/mobile/android/focus-android/README"

drft_log "All harness fixture tests passed"
