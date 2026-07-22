# DRFT Delivery Plan

## Goal

Build and run an unmodified Firefox Focus Android application locally through
Docker and in GitHub Actions without vendoring Mozilla's source tree. Keep the
build harness small, readable, reproducible, and ready for DRFT customizations
later.

## Delivery principles

- Each phase is a vertical slice with a concrete, testable outcome.
- Local builds run in a pinned Docker environment; contributors do not need to
  install the JDK, Android SDK, or NDK directly on the host.
- Docker and CI use the same build scripts and configuration.
- The host Android emulator/device remains outside the build container and is
  accessed through host-side `adb` for installation and smoke testing.
- Mozilla source and generated artifacts remain outside version control.
- Fail early with actionable errors instead of relying on Gradle failures.
- Prefer simple Bash with small, focused functions and explicit inputs.
- Pin external source and tool versions required for reproducibility.
- Do not introduce branding, package-name changes, or product patches until the
  upstream Focus baseline is proven to build and run.

## Definition of done for the baseline

- A clean checkout can build the pinned container image and fetch the pinned
  Firefox source snapshot from inside it.
- One documented Docker command produces only the requested Focus debug APKs in
  the host's `dist/` directory.
- An APK installs and launches on a supported Android emulator or device.
- The browser can load a page and clear browsing data without crashing.
- GitHub Actions builds the same pinned revision and publishes APK artifacts.
- Re-running local and CI builds reuses safe caches without skipping required
  work.
- Documentation contains accurate prerequisites, commands, outputs, and common
  failure recovery steps.

---

## Phase 1 — Make the build harness executable and testable

### User-visible outcome

A contributor can clone the repository and run the lightweight script checks on
the host or in Docker. CI can parse every script before any large download
begins.

### Work

- Convert Bash scripts and sourced configuration files from CRLF to LF.
- Add `.gitattributes` rules that preserve LF for `*.sh`, `*.env`, and workflow
  files while retaining appropriate Windows line endings for PowerShell.
- Confirm executable bits for the Bash entry points.
- Resolve the Bash compatibility contract:
  - either require Bash 4+ explicitly and validate it up front, or
  - remove associative arrays and other Bash 4-only constructs.
- Add `scripts/check.sh` as a fast, read-only validation entry point covering:
  - `bash -n` for all shell scripts;
  - ShellCheck when installed;
  - required configuration keys and basic value validation;
  - valid workflow YAML;
  - forbidden CRLF in Unix-executed files.
- Make config loading match its documentation. Treat committed configuration as
  assignments only, reject missing/empty required values, and keep local
  overrides explicit.
- Add concise, actionable diagnostics for an unsupported shell or malformed
  configuration.

### Acceptance criteria

- `bash scripts/check.sh` passes from a clean checkout.
- `bash -n scripts/*.sh scripts/lib/*.sh` passes.
- `bash scripts/fetch.sh --help`, `bash scripts/patch.sh --help`, and
  `bash scripts/build.sh --help` exit successfully.
- A test that introduces CRLF or removes a required config key fails with a
  clear explanation.
- No Firefox source download is needed for these checks.

---

## Phase 2 — Establish the local Docker build environment

### User-visible outcome

A contributor with Docker installed can prepare the complete, pinned Android
build toolchain without installing Java or Android tooling on the host.

### Work

- Add a readable, multi-stage `Dockerfile` with pinned base-image identity and
  explicit installations of:
  - JDK;
  - Android command-line tools;
  - configured SDK platform and build-tools;
  - configured NDK;
  - Bash, curl, tar, patch, Git, and other Focus build prerequisites.
- Keep tool versions sourced from, generated from, or validated against
  `config/versions.env` so Docker and CI cannot silently drift.
- Add `.dockerignore` excluding `.git`, `build/`, `dist/`, IDE files, secrets,
  and other unnecessary build context.
- Add a small `scripts/docker.sh` entry point with explicit commands such as
  `build-image`, `check`, `fetch`, `build`, `all`, and `shell`.
- Run the container as the invoking host user's UID/GID where supported so
  generated files are not owned by root.
- Bind-mount the repository at a fixed container path and keep `build/` and
  `dist/` visible on the host.
- Use named or explicitly located persistent volumes for Gradle and Android
  caches. Document their ownership, size, and cleanup commands.
- Set container resource guidance, especially disk space and memory required by
  the Firefox source extraction and Gradle build.
- Make container entry points forward arguments and exit codes without hiding
  build failures.
- Do not bake Mozilla source, Gradle caches, APKs, credentials, or local override
  files into the image.

### Acceptance criteria

- `bash scripts/docker.sh build-image` builds the pinned local builder image.
- `bash scripts/docker.sh check` runs Phase 1 validation inside the container.
- The image reports the configured Java, Android SDK, build-tools, and NDK
  versions.
- Files created in host-mounted `build/` and `dist/` are writable and removable
  by the host user.
- Rebuilding the image without Dockerfile/configuration changes uses Docker
  layer cache.
- No Android toolchain installation is required on the host.

---

## Phase 3 — Fetch and prepare a reproducible upstream source tree

### User-visible outcome

Running the Docker fetch command prepares exactly the configured Firefox
revision in the host-mounted build directory, and subsequent runs safely reuse
it.

### Work

- Verify that `FIREFOX_REPO`, `FIREFOX_REV`, and `FOCUS_MODULE_PATH` identify an
  available source snapshot containing Firefox Focus.
- Record source state in a manifest under `build/` containing at least the
  repository, revision, and extraction completion state.
- Replace presence-only fetch stamps with state validation. A fetch is reusable
  only when its manifest matches the current configuration and required source
  directories exist.
- Download to a temporary partial file and clean it after failures.
- Preserve the source archive optionally for CI caching, or cache the extracted
  source and its matching manifest together. Document the selected strategy.
- Validate archive extraction before marking the fetch complete.
- Make interruption recovery deterministic; an incomplete extraction must never
  be mistaken for a valid source tree.
- Keep `--force` as an explicit clean re-fetch operation.

### Acceptance criteria

- `bash scripts/docker.sh fetch` extracts the pinned source and writes a matching
  manifest into the host-mounted `build/` directory.
- A second Docker fetch performs no network download.
- Changing `FIREFOX_REV` invalidates the old source automatically.
- Removing a required source directory causes a safe re-fetch or a clear error.
- A failed download or extraction leaves no valid completion marker.

---

## Phase 4 — Build a local Firefox Focus debug APK in Docker

### User-visible outcome

One documented Docker command builds upstream Firefox Focus and places the
requested debug APKs in the host-mounted `dist/` directory.

### Work

- Add container preflight checks for the configured JDK, Android SDK platform,
  build-tools, NDK, disk space, memory, and other build-time tools.
- Distinguish required version mismatches from advisory warnings. Fail early
  when the known build cannot work with the detected toolchain.
- Verify the upstream Gradle project and requested assemble task before starting
  the expensive build.
- Keep an empty patch set valid for the baseline build.
- Replace the static `patches-applied` marker with a manifest/hash covering:
  - Firefox revision;
  - ordered patch file names;
  - patch contents;
  - patch target mapping.
- Ensure patch application is atomic or has a documented clean recovery path.
- Clean or isolate the selected variant's output before building.
- Stage only APKs produced for the requested variant, avoiding stale debug,
  beta, nightly, or release artifacts.
- Write a build manifest beside staged APKs with revision, variant, timestamp,
  and checksums.
- Preserve Gradle output on failure while keeping normal output readable.

### Acceptance criteria

- `bash scripts/docker.sh all focusDebug` succeeds on a host with only the
  documented Docker prerequisites.
- `dist/` contains only APKs from the current `focusDebug` invocation plus its
  build manifest.
- APK files are non-empty, checksums match, and Android build tools can inspect
  their package metadata.
- A second build reuses source and Gradle caches.
- Adding or editing a patch invalidates patch state automatically.
- An invalid variant fails before a lengthy Gradle build.

---

## Phase 5 — Install, launch, and smoke-test locally

### User-visible outcome

A contributor can install the generated APK on an emulator or connected device,
launch Firefox Focus, and verify basic browsing behavior.

### Work

- Add `scripts/install.sh` to select a staged APK and install it with `adb`.
- Run installation and emulator/device interaction on the host. Do not require
  privileged containers, USB device passthrough, or an emulator inside Docker.
- Require an explicit APK or fail clearly when multiple ABI choices are
  ambiguous; do not guess across incompatible devices.
- Detect connected devices, device ABI, and common authorization/offline errors.
- Add `scripts/smoke.sh` for a small baseline test that:
  - starts the app;
  - waits for the main activity;
  - confirms the process remains alive;
  - captures useful logs on failure.
- Document manual checks for opening a web page, navigation, and erasing session
  data.
- Keep tests based on the upstream Focus identity during this baseline phase.

### Acceptance criteria

- `bash scripts/install.sh <apk>` installs on a supported emulator/device.
- `bash scripts/smoke.sh` launches the app and exits successfully.
- The app loads a public page and clears browsing data in a manual smoke test.
- Failure output identifies installation, activity-launch, or runtime-crash
  problems and points to captured logs.

---

## Phase 6 — Reproduce the debug build in GitHub Actions

### User-visible outcome

Every relevant pull request and main-branch push validates the harness, builds
the pinned Focus debug variant, and publishes installable APK artifacts.

### Work

- Add a fast validation job using `scripts/check.sh` before the build job.
- Make the build job depend on successful validation.
- Cache source state consistently:
  - include the source manifest/stamp with the extracted tree, or
  - cache the downloaded archive and perform deterministic extraction.
- Key source cache entries by repository and Firefox revision.
- Key Gradle caches by runner OS, relevant Gradle files, and upstream revision;
  use bounded restore keys to avoid unsafe cache reuse.
- Add cache diagnostics so logs reveal whether reuse occurred.
- Run the same underlying `scripts/all.sh focusDebug` build path used by the
  local container. Decide explicitly whether CI builds with the published Docker
  image or recreates the pinned toolchain directly; add a drift check if the
  latter is retained for better GitHub cache performance.
- Validate staged APK metadata and checksums before artifact upload.
- Upload the build manifest with the APKs.
- Pin GitHub Actions to reviewed versions, preferably immutable commit SHAs with
  readable version comments.
- Use least-privilege workflow permissions and appropriate timeouts.

### Acceptance criteria

- A clean GitHub-hosted runner builds `focusDebug` successfully.
- The workflow artifact contains only the expected APKs and build manifest.
- A warm run demonstrates source and Gradle cache reuse.
- A malformed script fails in the validation job without downloading Firefox.
- CI and local build manifests report the same upstream revision and variant.

---

## Phase 7 — Harden maintenance and failure recovery

### User-visible outcome

Upstream revisions can be tested and updated predictably, and common failures
have documented recovery commands.

### Work

- Add automated tests for config validation, manifest invalidation, patch
  ordering, empty patch sets, and artifact selection using small fixtures.
- Test scripts in paths containing spaces and on supported shells.
- Test Docker argument forwarding, UID/GID mapping, cache reuse, and cleanup.
- Add CI checks for accidental committed build artifacts or source archives.
- Document disk usage, cache locations, selective cleaning, and recovery after
  interrupted fetch, patch, and build steps.
- Add an upstream-update checklist that verifies source availability, patch
  dry-run, local build, emulator smoke test, and CI before merging a new pin.
- Add dependency/update automation where it can safely open reviewable pull
  requests.
- Add the repository's declared MPL-2.0 license file and clarify the boundary
  between DRFT-owned files and fetched Mozilla source.

### Acceptance criteria

- Automated harness tests run without downloading Firefox.
- Documented cleanup commands recover every intentionally simulated partial
  state.
- An upstream pin change cannot be merged without validation and a successful
  debug build.
- License and contribution expectations are explicit.

---

## Phase 8 — Establish a release-capable build

### User-visible outcome

A manually triggered workflow can produce a clearly identified, signed or
explicitly unsigned release candidate without risking accidental publication.

### Work

- Decide whether release APKs are locally signed, CI-signed, or intentionally
  emitted unsigned for a separate signing process.
- If CI signs, document and implement keystore generation, encrypted secrets,
  password handling, secret masking, and rotation/recovery procedures.
- Verify APK signing and package metadata before upload.
- Restrict artifact collection to the requested release variant.
- Validate manual workflow input against an allowlist instead of passing an
  arbitrary variant through to Gradle.
- Export every release-note field explicitly, including `FIREFOX_REPO`.
- Keep GitHub Releases as drafts until an install/smoke check and human review
  are complete.
- Add provenance/checksum information suitable for release verification.

### Acceptance criteria

- A manual `focusRelease` workflow produces only the intended release APKs.
- Signing status is unambiguous and verified automatically.
- No signing secret appears in logs or artifacts.
- A tag workflow creates a draft release with accurate source, revision,
  variant, checksums, and APK attachments.

---

## Phase 9 — Add DRFT customization infrastructure later

### User-visible outcome

After the upstream baseline is stable, DRFT can add small, reviewable
customizations without weakening build reproducibility.

### Work

- Start with a minimal identity patch: application ID, display name, version
  metadata, and branding assets.
- Decide whether identity values belong in patch files, Gradle properties, or a
  generated overlay; avoid configuration values that are declared but unused.
- Add one focused patch per concern with rationale in its header.
- Validate application-ID uniqueness and side-by-side installation with upstream
  Firefox Focus.
- Add tests for patch application and expected customized resources/metadata.
- Expand into Android Components or Gecko patches only when a concrete feature
  requires them.

### Acceptance criteria

- DRFT and upstream Firefox Focus install side by side.
- The installed app reports DRFT identity and expected version metadata.
- Every customization is represented by a reviewable patch or generated overlay
  with automated validation.
- Removing all customization patches still yields the proven upstream baseline.

## Explicit non-goals until the baseline is complete

- Compiling Gecko or GeckoView locally.
- Vendoring the Firefox source tree.
- Privacy-policy changes or security hardening patches.
- DRFT branding and application-ID changes.
- Play Store publication or automatic public GitHub Releases.
- Supporting every host operating system and every Android ABI from day one.
- Running the Android emulator inside the build container.

## Recommended implementation order

Complete Phases 1 through 6 in order. Phase 7 can then improve confidence while
Phase 8 establishes controlled release output. Begin Phase 9 only after the
unmodified Focus baseline builds and launches both locally and in CI.
