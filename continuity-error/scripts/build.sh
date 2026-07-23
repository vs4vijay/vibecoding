#!/usr/bin/env bash
set -euo pipefail

GODOT_BIN="${GODOT_BIN:-godot}"
rtk mkdir -p build/web
rtk "$GODOT_BIN" --headless --path . --export-release "Web" build/web/index.html
