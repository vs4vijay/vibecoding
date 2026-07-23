# DRFT

DRFT is a reproducible build harness for the unmodified Firefox Focus Android
baseline. Mozilla source is fetched at a pinned revision and is never vendored.
DRFT-owned scripts are MPL-2.0; fetched source retains its upstream notices.

## Prerequisites

- Docker 24+ with BuildKit
- Bash 4+ for host scripts
- 16 GB RAM recommended and at least 20 GB free disk
- `adb` plus one supported Android emulator/device for install/smoke testing

No host JDK, Android SDK, or NDK is needed. Versions are pinned in
`config/versions.env` and installed in the builder image.

## Build and verify

```bash
bash scripts/check.sh
bash scripts/test.sh
bash scripts/docker.sh build-image
bash scripts/docker.sh versions
bash scripts/docker.sh all focusDebug
bash scripts/docker.sh shell scripts/verify-artifacts.sh
```

Only APKs from the requested invocation and `dist/build-manifest.txt` are
staged. The current baseline intentionally stages only the `arm64-v8a` APK;
supporting every Android ABI is not a baseline goal. Source state lives in
`build/state/source.env`; a matching tree is reused. Gradle uses the
`drft-gradle-cache` Docker volume. Inspect it with
`docker system df -v` and remove it with
`bash scripts/docker.sh clean-cache`. Set `DRFT_GRADLE_CACHE_HOST` to use a
host directory instead (CI uses `.cache/gradle`).
If the checkout filesystem is short on space, set `DRFT_BUILD_STORAGE` to an
absolute host directory with at least 15 GB free; it is mounted at
`/workspace/build` without changing manifest or build paths.

## Install and smoke test

Device interaction intentionally stays on the host:

```bash
bash scripts/install.sh dist/path/to/the-explicit.apk
bash scripts/smoke.sh
```

Set `ANDROID_SERIAL` if more than one device is attached. The baseline package
is `org.mozilla.focus`; override `DRFT_PACKAGE_ID` only when testing an upstream
variant with a different ID. After the automated launch check, manually open a
public HTTPS page, navigate back/forward, tap the erase button, and confirm the
session disappears without a crash.

## Recovery and maintenance

- Interrupted fetch: rerun `bash scripts/docker.sh fetch`; partial files are
  discarded and an incomplete tree has no valid manifest.
- Changed/broken patch: `bash scripts/docker.sh fetch --force`, then patch
  again. Patch state is content-addressed and refuses unsafe double-application.
- Stale artifacts: `bash scripts/clean.sh --dist`.
- Full source reset: `bash scripts/clean.sh --build`.
- Full local reset: `bash scripts/clean.sh --all`, then optionally remove the
  Gradle volume with `bash scripts/docker.sh clean-cache`.

Before changing the upstream pin, verify the new commit exists, update both
`FIREFOX_REV` and `FIREFOX_VERSION`, run checks and fixture tests, force-fetch,
dry-run/apply patches, build `focusDebug`, install and smoke-test it, and require
green CI before merging. Dependabot opens monthly GitHub Actions updates for
review. Do not commit anything under `build/`, `dist/`, `.cache/`, source
archives, credentials, or signing keys.

## CI and releases

CI runs lightweight validation before building the same Docker path used
locally. Source cache keys include repository and revision; Gradle keys include
the upstream revision and toolchain inputs. The artifact contains APKs plus the
manifest.

The manual/tag release workflow accepts only `focusRelease` and currently
produces an explicitly **unsigned** release candidate. Tag releases remain
drafts. `SHA256SUMS`, source identity, signing status, and the build manifest
are attached. Signing and publication require a separate reviewed process; no
keystore secret is accepted by this workflow.

DRFT branding and application-ID patches are deliberately gated until the
unmodified Focus baseline has built and passed the device smoke test in both
local and CI environments.
