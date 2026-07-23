# AGENTS.md

## Repository purpose

DRFT is a reproducible Docker build harness for an initially unmodified
Firefox Focus Android baseline. Mozilla source is fetched at a pinned revision
and must never be vendored into this repository. Keep the harness small,
reviewable, deterministic, and ready for later DRFT-specific patches.

Read `plan.md` for delivery status and acceptance criteria. Read `README.md`
and `scripts/README.md` before changing user-facing commands.

## Required command conventions

- Prefix every shell command with `rtk`, including every command in a chain.
- Use `bun` instead of `npm`.
- Use `uv` instead of invoking `python` directly.
- Use Bash for repository scripts. Bash 4 or newer is required.
- Preserve LF endings in shell scripts, environment files, and workflow YAML.
- Keep shell entry points executable.

Examples:

```bash
rtk bash scripts/check.sh
rtk bash scripts/test.sh
rtk git diff --check
```

## Proven baseline

The verified upstream identity is defined in `config/versions.env`:

- Firefox repository: `mozilla-firefox/firefox`
- Firefox revision: `a077abc2b0f43ed7cc59a8bfcd873e683500d23a`
- Source tree: `mozilla-central`
- Java: 17
- Android SDK platforms: 36 and 36.1
- Android build-tools: 36.1.0
- Android NDK: 29.0.14206865
- Bundletool: 1.18.3
- Android command-line tools: 13114758

The builder explicitly uses Linux `amd64`, including on ARM hosts, because the
required Google Android Linux binaries are not published for ARM. Do not
silently change the platform or any pinned tool version.

The proven debug build is:

```bash
rtk bash scripts/docker.sh all focusDebug
```

It resolves to Gradle task `focus-android:assembleFocusDebug`. The initial real
build completed 1,412 Gradle tasks. The current baseline intentionally stages
only the `arm64-v8a` APK.

The last verified APK identity was:

```text
dist/focus/debug/focus-android-focus-arm64-v8a-debug.apk
SHA-256 c90c717b47efa13ea3a92c190473fa792ee16713dcd73231590ac7f9f3d5e5d7
```

This checksum is evidence for that build, not a permanent assertion: timestamps
or upstream build behavior can change output bytes. Always trust the current
`dist/build-manifest.txt` and rerun artifact verification.

## Architecture and invariants

### Source acquisition

- `scripts/fetch.sh` downloads the pinned immutable source archive atomically.
- The extracted source is stored under `build/firefox-src`.
- `build/state/source.env` is the source-of-truth reuse manifest.
- Reuse requires matching repository/revision metadata and required directories.
- A partial archive or extraction must never produce a valid completion state.
- Real archive sources receive blobless Git metadata so Mozilla `mach artifact`
  can resolve matching Taskcluster artifacts.
- Fixture archives supplied through `DRFT_SOURCE_ARCHIVE` deliberately skip Git
  metadata.
- Use `--force` for an explicit clean refetch.

### Patch handling

- An empty patch set is valid for the upstream baseline.
- Patches are applied in deterministic filename order.
- Patch state covers the Firefox revision, ordered filenames, contents, and
  target mapping.
- Adding, deleting, reordering, or editing a patch must invalidate patch state.
- Do not add branding, application-ID, or product patches before the Phase 9
  gates in `plan.md` are satisfied.

### Build and staging

- Docker and CI must call the same underlying repository scripts.
- Build scripts clean `dist/`, not Gradle-managed output directories. Deleting
  Gradle packaging output while retaining incremental state previously caused a
  stalled emulated JVM.
- Variant input is allowlisted and must fail before Gradle for unknown values.
- Stage only APKs from the requested invocation.
- `dist/` should contain only the current APK set and
  `dist/build-manifest.txt`, except for explicitly generated release metadata.
- The artifact verifier checks manifest checksums, Android package metadata,
  DEX content, `libxul.so`, and `libmozglue.so`.
- Do not weaken artifact selection to accept arbitrary APKs or stale variants.

### Caches and storage

- Source state remains host-visible under `build/`.
- Gradle normally uses the `drft-gradle-cache` Docker volume.
- CI may use `.cache/gradle` through `DRFT_GRADLE_CACHE_HOST`.
- For filesystems with insufficient space, set `DRFT_BUILD_STORAGE` to an
  absolute host directory with at least 15 GB available.
- A real source checkout is roughly 4 GB; its compressed source archive is
  roughly 954 MB. Plan for at least 20 GB free disk and 16 GB RAM.
- Never commit `build/`, `dist/`, `.cache/`, source archives, credentials,
  keystores, or signing secrets.

### Signing and releases

- Debug builds are signed with the Android debug certificate.
- The release workflow currently produces an explicitly unsigned
  `focusRelease` candidate.
- `focusRelease` is the only allowed release workflow variant.
- `scripts/verify-signing.sh --expect-unsigned` must succeed before an unsigned
  candidate is labeled or checksums are published.
- Tag releases remain drafts and require a separate reviewed signing and
  publication process.
- Do not add or print signing secrets without a separately approved design.

## Validation workflow

Run lightweight validation after every relevant change:

```bash
rtk bash scripts/check.sh
rtk bash scripts/test.sh
rtk git diff --check
```

`scripts/check.sh` covers Bash syntax, configuration grammar and required keys,
LF endings, workflow YAML, and ShellCheck when installed. The pinned Docker
image contains ShellCheck, so also run:

```bash
rtk bash scripts/docker.sh check
rtk bash scripts/docker.sh versions
```

After a real debug build, verify the staged result:

```bash
rtk bash scripts/docker.sh shell bash scripts/verify-artifacts.sh
rtk bash scripts/docker.sh shell bash scripts/verify-signing.sh --expect-signed
```

Remove transient `dist/signing-status.txt` after a local signing-state test if
it was generated, then rerun artifact verification so `dist/` remains clean.

For an invalid-variant change, confirm rejection is immediate and happens
before Gradle starts. For fetch or patch changes, run the fixture E2E suite and
then a real fetch/build when the change can affect production behavior.

## Device testing

Device interaction stays on the host; do not put an emulator in Docker or
require privileged USB passthrough.

```bash
rtk bash scripts/install.sh dist/path/to/explicit.apk
rtk bash scripts/smoke.sh
```

- Require an explicit APK when selection could be ambiguous.
- Use `ANDROID_SERIAL` when multiple devices are connected.
- The upstream baseline package is `org.mozilla.focus`.
- Check device authorization, online state, and ABI compatibility.
- After automated launch/process/crash checks, manually load a public HTTPS
  page, test back/forward navigation, erase the session, and confirm no crash.

No device was attached during the last implementation pass. Installation,
launch, browsing, and erase-session acceptance therefore remain external gates;
never report them as passed without fresh device evidence.

## CI and external gates

The workflows are implemented with validation-before-build, read-only default
permissions, explicit timeouts, revision-aware source/Gradle caches, and
artifact verification before upload.

Repository-local validation cannot prove a GitHub-hosted run. Until the current
changes are pushed and workflows run successfully, preserve these explicit
gates:

- GitHub-hosted `focusDebug` build and artifact upload
- warm hosted cache reuse
- manual hosted `focusRelease` candidate
- tag-triggered draft release metadata and attachments

Do not mark these gates complete based solely on workflow syntax validation.

## Recovery

- Interrupted or invalid source:
  `rtk bash scripts/docker.sh fetch --force`
- Stale staged artifacts:
  `rtk bash scripts/clean.sh --dist`
- Full source reset:
  `rtk bash scripts/clean.sh --build`
- Full repository-local generated-state reset:
  `rtk bash scripts/clean.sh --all`
- Gradle volume cleanup:
  `rtk bash scripts/docker.sh clean-cache`

Preserve Gradle output after build failures for diagnosis. Do not delete broad
paths, user data, or caches unrelated to DRFT.

## Change discipline

- Preserve the separation between DRFT-owned MPL-2.0 files and fetched Mozilla
  source with its upstream licensing.
- Keep pins centralized and validated through `config/versions.env`.
- Avoid presence-only stamps; all reuse decisions must validate identity and
  completeness.
- Keep local and CI paths behaviorally identical.
- Update documentation when commands, outputs, constraints, or recovery steps
  change.
- Update the relevant phase status and verification record in `plan.md` after
  implementing and testing phase work.
- Never claim an E2E result that was not actually executed in the applicable
  environment.

