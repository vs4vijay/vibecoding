#!/usr/bin/env bash
set -euo pipefail

GODOT_BIN="${GODOT_BIN:-godot}"
rtk mkdir -p build/web
rtk "$GODOT_BIN" --headless --path . --export-release "Web" build/web/index.html

for artifact in build/web/index.html build/web/index.js build/web/index.pck build/web/index.wasm; do
	if [[ ! -s "$artifact" ]]; then
		echo "Web export failed: missing or empty artifact: $artifact" >&2
		exit 1
	fi
done
