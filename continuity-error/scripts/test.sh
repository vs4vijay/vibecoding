#!/usr/bin/env bash
set -euo pipefail

GODOT_BIN="${GODOT_BIN:-godot}"
rtk "$GODOT_BIN" --headless --path . --script res://tests/test_runner.gd
