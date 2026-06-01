# DRFT build scripts

Self-contained POSIX shell scripts. Same commands run locally and in CI.

| Script             | What it does                                                    |
| ------------------ | --------------------------------------------------------------- |
| `fetch.sh`         | Download + extract `mozilla-firefox/firefox` at `FIREFOX_REV`.  |
| `patch.sh`         | Apply every `*.patch` under `patches/` to the source tree.      |
| `build.sh [var]`   | Run `app:assemble<Variant>` via Focus's own gradlew.            |
| `all.sh [var]`     | `fetch` → `patch` → `build`.                                    |
| `clean.sh [scope]` | Wipe `build/`, `dist/`, or both.                                |
| `make.ps1 <cmd>`   | Windows entry point — forwards to bash via Git Bash or WSL.     |

## Environment

Everything is driven by `config/versions.env`. Override locally without
committing by creating `config/versions.local.env` (gitignored):

```
# config/versions.local.env
DRFT_VARIANT="focusDebug"
FIREFOX_REV="<some-other-sha>"     # try a different upstream pin
```

Runtime knobs (env vars, not config file):

| Variable                 | Effect                                                  |
| ------------------------ | ------------------------------------------------------- |
| `DRFT_USE_GRADLE_DAEMON` | `1` to use the Gradle daemon (faster local rebuilds).   |
| `DRFT_BASH` (Windows)    | Explicit path to bash.exe, skipping autodiscovery.      |
| `JAVA_HOME`              | Standard Java location. Scripts warn on major mismatch. |
| `ANDROID_HOME`           | Required. `ANDROID_SDK_ROOT` accepted as alias.         |

## Reuse outside DRFT

The scripts are intentionally driven by `config/versions.env` and don't hard-code
paths or product names. To use the same harness for another Mozilla-derived
build:

1. Copy `scripts/`, `config/`, `patches/`.
2. Edit `versions.env` (`FIREFOX_REV`, `FOCUS_MODULE_PATH`, `DRFT_VARIANT`).
3. Drop in your own patches under `patches/`.

## Stamps

Long steps leave a marker under `build/.stamps/`:

- `fetch-<FIREFOX_REV>` — sources at this commit are extracted.
- `patches-applied`     — patches successfully applied on top.

Bumping `FIREFOX_REV` invalidates both. `scripts/fetch.sh --force` forces a
re-fetch regardless.
