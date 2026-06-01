# DRFT

DRFT is an Android browser derived from **Firefox Focus**, built directly from
Mozilla's source tree with our own patches applied on top. The model is the
same one [IronFox](https://gitlab.com/ironfox-oss/IronFox) uses for Fenix:

- pin an upstream commit of `mozilla-firefox/firefox`,
- check it out fresh on every build,
- apply DRFT-owned `.patch` files,
- compile the Focus subtree with its own `gradlew`.

Patches live in this repo; the upstream tree is never committed here.

## Repo layout

```
.github/workflows/  ci.yml, release.yml             — GitHub Actions
config/             versions.env                    — upstream pin + toolchain
patches/
  focus-android/    *.patch  → mobile/android/focus-android/
  components/       *.patch  → mobile/android/android-components/
  tree/             *.patch  → repo root (Gecko, etc.)
scripts/
  fetch.sh          download + extract upstream
  patch.sh          apply patches/
  build.sh          gradle assemble<Variant>
  clean.sh          wipe build/ and/or dist/
  all.sh            fetch + patch + build
  make.ps1          PowerShell wrapper for Windows
  lib/common.sh     shared bash helpers
build/              gitignored — extracted source tree + gradle caches
dist/               gitignored — staged APK output (also CI artifact)
```

The directory is small on purpose: everything that bloats (the firefox tree,
gradle caches, NDK toolchains) lives under `build/` or in CI caches, never
checked in.

## Build it once

### Prerequisites

| Tool        | Version             | Notes                                          |
| ----------- | ------------------- | ---------------------------------------------- |
| JDK         | **21** (Temurin)    | matches `JDK_VERSION` in `config/versions.env`. JDK 17 is **not** enough for current mozilla-central — AGP refuses to start. |
| Android SDK | compile-sdk 35, build-tools 35.0.0 | `$ANDROID_HOME` must be set      |
| Android NDK | 27.2.12479018       | installed under `$ANDROID_HOME/ndk/...`        |
| curl, tar, patch | any recent     | bash basics; Git Bash on Windows is fine       |
| Python 3    | any recent          | only needed at gradle-build time (Glean); install if the build complains |
| ~15 GB free | disk                | extracted firefox tree + gradle cache + APKs   |

#### Install JDK 21

- **Windows:** `winget install EclipseAdoptium.Temurin.21.JDK`  then point `$env:JAVA_HOME` at it.
- **macOS:** `brew install --cask temurin@21`
- **Linux:** `apt install temurin-21-jdk` (after adding the Adoptium repo) or `sdk install java 21-tem`.

The scripts emit a warning if `java -version` doesn't report major 21, then proceed — gradle will hard-fail later with a clearer message.

### Linux / macOS

```bash
scripts/all.sh                # fetch + patch + build (focusDebug by default)
scripts/build.sh focusRelease # rebuild as release
```

### Windows

You need a POSIX shell. Install [Git for Windows](https://git-scm.com/download/win)
(comes with Git Bash) or WSL — the wrapper finds either:

```powershell
.\scripts\make.ps1 all                  # fetch + patch + build
.\scripts\make.ps1 build focusRelease   # rebuild
.\scripts\make.ps1 clean                # wipe build/ and dist/
```

Set `$env:DRFT_BASH` to override the auto-detected shell.

### Output

APKs land in `dist/` mirroring upstream's `app/build/outputs/apk/<variant>/<abi>/` layout, e.g.

```
dist/focus/arm64-v8a/debug/app-focus-arm64-v8a-debug.apk
dist/focus/armeabi-v7a/debug/app-focus-armeabi-v7a-debug.apk
```

## Iterate on a patch

```bash
# 1. Hand-edit files inside the extracted upstream tree:
$EDITOR build/firefox-src/mobile/android/focus-android/app/src/main/...

# 2. Test the change without re-fetching:
scripts/build.sh

# 3. Capture as a patch when you're happy:
#    See patches/README.md for the exact diff command for each target dir.
```

## Update the upstream pin

When you want a newer Mozilla snapshot:

1. Find the commit SHA you want from
   <https://github.com/mozilla-firefox/firefox/commits/main>.
2. Edit `config/versions.env`:
   ```
   FIREFOX_REV="<new-sha>"
   FIREFOX_VERSION="<human-readable-version>"
   ```
3. `scripts/fetch.sh --force` — re-download.
4. `scripts/patch.sh` — re-apply; fix any rejects.
5. Commit the bump.

`config/versions.local.env` (gitignored) is honored if you want to test a pin
without committing.

## CI

- **`ci.yml`** runs on PRs and pushes to `main`/`master`. Builds `focusDebug`,
  uploads APKs as a workflow artifact (7-day retention).
- **`release.yml`** runs on `v*` tag push (or manual dispatch). Builds the
  variant you choose (default `focusRelease`), uploads as artifact, and on a
  tag push creates a **draft** GitHub Release with the APKs attached.

The firefox source tarball is cached keyed by `FIREFOX_REV`, so subsequent
runs at the same pin skip the ~700MB download.

## How DRFT compares to IronFox

| Aspect         | IronFox                                          | DRFT (today)                                  |
| -------------- | ------------------------------------------------ | --------------------------------------------- |
| Target         | Fenix (full Firefox for Android)                 | Focus (privacy browser)                       |
| Build engine   | `mach gradle` (builds Gecko + GeckoView locally) | upstream `focus-android/gradlew` (prebuilt GeckoView from Mozilla maven) |
| Build time     | ~6 hours in CI                                   | ~15–30 minutes in CI                          |
| Patch surface  | 88 patches + 5 overlay dirs                      | empty to start; add as needed                 |
| Components     | also patches application-services, glean, microG | not yet — add when needed                     |

The lightweight setup is a deliberate first step. When DRFT needs to patch
Gecko/a-c/etc. itself, drop those `.patch` files into the right bucket under
`patches/` — the script already supports `patches/tree/` and
`patches/components/`. Switching to a full `mach`-driven build is a future
project once we actually need it.

## License

Patches and scripts in this repo are licensed under MPL-2.0 (matching upstream
Mozilla code). Upstream sources retain their own MPL-2.0 license — they are
fetched at build time, not vendored.
