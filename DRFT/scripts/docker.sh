#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"
drft_load_config
drft_require_cmd docker

usage() { printf 'Usage: %s {build-image|versions|check|fetch|patch|build|all|shell|clean-cache} [args...]\n' "$0"; }
command_name="${1:-}"; [ $# -eq 0 ] || shift
case "$command_name" in
  -h|--help|'') usage; [ -n "$command_name" ]; exit ;;
  build-image)
    docker build --platform linux/amd64 --pull=false --tag "$DRFT_DOCKER_IMAGE" \
      --build-arg BASE_IMAGE="$DOCKER_BASE_IMAGE" --build-arg JDK_VERSION="$JDK_VERSION" \
      --build-arg ANDROID_CMDLINE_TOOLS_VERSION="$ANDROID_CMDLINE_TOOLS_VERSION" \
      --build-arg ANDROID_COMPILE_SDK="$ANDROID_COMPILE_SDK" --build-arg ANDROID_COMPILE_SDK_EXTENSION="$ANDROID_COMPILE_SDK_EXTENSION" \
      --build-arg ANDROID_BUILD_TOOLS="$ANDROID_BUILD_TOOLS" \
      --build-arg ANDROID_NDK_VERSION="$ANDROID_NDK_VERSION" --build-arg BUNDLETOOL_VERSION="$BUNDLETOOL_VERSION" "$DRFT_REPO_ROOT"
    exit ;;
  clean-cache)
    docker volume rm drft-gradle-cache
    exit ;;
esac

case "$command_name" in
  versions) target=(bash scripts/image-versions.sh) ;;
  check|fetch|patch|build|all) target=(bash "scripts/${command_name}.sh" "$@") ;;
  shell) if [ $# -gt 0 ]; then target=("$@"); else target=(bash); fi ;;
  *) usage >&2; drft_die "unknown Docker command: $command_name" ;;
esac
mkdir -p "$DRFT_BUILD_DIR" "$DRFT_DIST_DIR"
uid="$(id -u)"; gid="$(id -g)"
gradle_mount="drft-gradle-cache:/gradle-cache"
if [ -n "${DRFT_GRADLE_CACHE_HOST:-}" ]; then
  mkdir -p "$DRFT_GRADLE_CACHE_HOST"; gradle_mount="$DRFT_GRADLE_CACHE_HOST:/gradle-cache"
else
  docker run --platform linux/amd64 --rm --user 0:0 -v drft-gradle-cache:/gradle-cache "$DRFT_DOCKER_IMAGE" chown "$uid:$gid" /gradle-cache
fi
mkdir -p "$DRFT_BUILD_DIR/container-home/.android"
touch "$DRFT_BUILD_DIR/container-home/.android/analytics.settings"
build_mount=()
if [ -n "${DRFT_BUILD_STORAGE:-}" ]; then
  mkdir -p "$DRFT_BUILD_STORAGE/container-home/.android"
  touch "$DRFT_BUILD_STORAGE/container-home/.android/analytics.settings"
  build_mount=(-v "$DRFT_BUILD_STORAGE:/workspace/build")
fi
docker run --platform linux/amd64 --rm --init --user "$uid:$gid" \
  -e HOME=/workspace/build/container-home -e ANDROID_USER_HOME=/workspace/build/container-home/.android -e GRADLE_USER_HOME=/gradle-cache \
  -v "$DRFT_REPO_ROOT:/workspace" -v "$gradle_mount" \
  "${build_mount[@]}" \
  -w /workspace "$DRFT_DOCKER_IMAGE" "${target[@]}"
