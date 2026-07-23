# DRFT build scripts

The harness requires Bash 4+ and is shared by local Docker builds and CI.

| Script | Purpose |
| --- | --- |
| `check.sh` | Fast syntax, config, line-ending, ShellCheck, and workflow checks. |
| `test.sh` | Network-free fixture E2E tests for fetch, patch, and failure paths. |
| `docker.sh` | Build/run the pinned image and manage the Gradle cache. |
| `fetch.sh` | Atomically fetch the pinned Firefox archive and blobless Git metadata. |
| `patch.sh` | Apply the ordered, content-addressed patch set. |
| `build.sh [variant]` | Configure Mozilla artifact mode and assemble an allowlisted Focus variant. |
| `all.sh [variant]` | Run fetch, patch, and build in order. |
| `verify-artifacts.sh` | Verify manifest checksums, APK metadata, dex, and Gecko native libraries. |
| `verify-signing.sh` | Prove that staged APKs are signed or unsigned as expected. |
| `install.sh` / `smoke.sh` | Install and launch through host-side `adb`. |
| `clean.sh` | Clean generated build or distribution state. |

Configuration comes from `config/versions.env`. A gitignored
`config/versions.local.env` may contain assignment-only local overrides.
Build outputs and state live under `build/` and `dist/`; the source and patch
manifests replace presence-only stamps. See the root README for prerequisites,
external build storage, cache cleanup, device testing, and release behavior.
