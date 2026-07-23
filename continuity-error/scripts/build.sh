#!/usr/bin/env bash
set -euo pipefail

GODOT_BIN="${GODOT_BIN:-godot}"
rtk mkdir -p build/web
# rtk mkdir -p build/windows
# rtk "$GODOT_BIN" --headless --path . --export-release "Windows Desktop"
rtk "$GODOT_BIN" --headless --path . --export-release "Web"
