# CI/CD Workflows

This repository includes comprehensive CI/CD pipelines using GitHub Actions to build, test, and release firmware for all supported boards.

## Workflows

### 1. PR Gate (`pr-gate.yml`)

**Trigger**: Pull requests to `main` or `develop` branches

**Purpose**: Validates that all board configurations compile successfully before merging.

**Process**:
1. Builds firmware for all 9 supported boards in parallel
2. Validates that each firmware binary is at least 100KB (sanity check)
3. Uploads artifacts for each board (retained for 7 days)
4. Fails the PR if any board fails to build

**Artifacts**: `firmware-{board-name}` (e.g., `firmware-esp32dev`)

### 2. CI Build (`ci.yml`)

**Trigger**: Pushes to `main`, `develop`, or `copilot/**` branches

**Purpose**: Continuous integration builds for development tracking.

**Process**:
1. Builds firmware for all 9 supported boards in parallel
2. Generates versioned firmware binaries (`ESP32-Mirage-{version}-{board}.bin`)
3. Creates a build summary table in the workflow run
4. Uploads artifacts (retained for 30 days)
5. Validates all builds are successful

**Artifacts**: `firmware-{board-name}` with versioned filenames

**Version**: Uses short commit SHA (e.g., `a1b2c3d`) unless triggered by a tag

### 3. Release (`release.yml`)

**Trigger**: 
- Git tags matching `v*.*.*` or `v*.*.*-*` (e.g., `v1.0.0`, `v1.0.0-beta`)
- Manual workflow dispatch with version input

**Purpose**: Creates GitHub releases with firmware for all boards.

**Process**:
1. Builds firmware for all 9 supported boards in parallel
2. Creates merged firmware binaries with bootloader and partitions using `esptool`
3. Generates comprehensive release notes with:
   - Board support table
   - Installation instructions
   - Known issues
   - Documentation links
4. Creates a GitHub release with all firmware binaries attached
5. Marks pre-releases for versions containing `-` (e.g., `-alpha`, `-beta`, `-rc1`)

**Artifacts**: `firmware-{board-name}` uploaded to GitHub Release

**Release Files**: `ESP32-Mirage-{version}-{board}.bin` for each board

## Supported Boards

All workflows build for these boards:
- `esp32dev` - Generic ESP32-DevKit
- `lilygo-t-display` - LilyGo T-Display
- `esp32-geek` - ESP32 Geek
- `m5stack-core-esp32` - M5Stack Core/Core2
- `m5stack-cores3` - M5Stack CoreS3
- `m5stack-cardputer` - M5Stack Cardputer
- `m5stick-c-plus` - M5StickC Plus
- `m5stick-c-plus2` - M5StickC Plus2

## Viewing Build Results

### From Pull Requests
1. Go to the PR page
2. Scroll to the checks section at the bottom
3. Click "Show all checks" → "Details" next to "PR Gate"
4. View the workflow run and download artifacts if needed

### From Actions Tab
1. Go to the repository's "Actions" tab
2. Select the workflow you want to view
3. Click on a specific workflow run
4. Scroll down to "Artifacts" to download firmware binaries

### From Releases Page
1. Go to the repository's "Releases" page
2. Find your desired version
3. Download the appropriate `.bin` file for your board

## Downloading Artifacts

### Using GitHub Web Interface
1. Navigate to the workflow run
2. Scroll to "Artifacts" section
3. Click on the artifact name to download

### Using GitHub CLI
```bash
# List artifacts for a workflow run
gh run view <run-id> --repo vs4vijay/ESP32-Mirage

# Download all artifacts
gh run download <run-id> --repo vs4vijay/ESP32-Mirage

# Download specific artifact
gh run download <run-id> --name firmware-esp32dev --repo vs4vijay/ESP32-Mirage
```

## Creating a Release

### Automatic Release (Recommended)
1. Create and push a version tag:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

2. GitHub Actions will automatically:
   - Build all board firmwares
   - Create a GitHub release
   - Upload all firmware binaries
   - Generate release notes

### Manual Release
1. Go to "Actions" tab
2. Select "Build and Release" workflow
3. Click "Run workflow"
4. Enter the version (e.g., `v1.0.0`)
5. Click "Run workflow" button

## Workflow Configuration

### Caching
All workflows use caching to speed up builds:
- **PlatformIO cache**: `~/.platformio/.cache`
- **pip cache**: `~/.cache/pip`

Cache keys are based on the board and `platformio.ini` hash.

### Python Version
All workflows use Python 3.11 for consistency and performance.

### PlatformIO Version
Workflows install the latest PlatformIO Core using pip:
```bash
pip install -U platformio
```

### Build Flags
Board-specific build flags are defined in `platformio.ini`. Each environment includes:
- Board-specific defines (e.g., `-DBOARD_LILYGO_T_DISPLAY`)
- Pin configurations (e.g., `-DTFT_CS=5`)
- Screen dimensions (e.g., `-DSCREEN_WIDTH=240`)

## Troubleshooting CI/CD

### Build Failures

**Symptom**: Workflow fails during build step

**Solutions**:
1. Check the build logs for specific errors
2. Test locally: `pio run -e <board-name>`
3. Verify `platformio.ini` syntax
4. Check library dependencies are available

### Artifact Upload Failures

**Symptom**: Build succeeds but artifact upload fails

**Solutions**:
1. Verify the firmware.bin file exists: `ls -la .pio/build/<board>/`
2. Check workflow permissions (should have `contents: write` for releases)
3. Verify artifact name doesn't contain invalid characters

### Release Creation Failures

**Symptom**: Release workflow fails to create GitHub release

**Solutions**:
1. Verify `github_release` environment exists in repository settings
2. Check that the tag follows the correct format (`v*.*.*`)
3. Ensure workflow has `contents: write` permission
4. Verify `softprops/action-gh-release` is accessible

### Cache Issues

**Symptom**: Builds are slower than expected or libraries re-download

**Solutions**:
1. Check cache is being saved: look for "Cache saved" in workflow logs
2. Verify cache key is correctly generated
3. Manually clear cache: Settings → Actions → Caches → Delete specific cache

## Customizing Workflows

### Adding a New Board

1. Add board configuration to `platformio.ini`
2. Update the `matrix.board` list in all three workflow files:
   ```yaml
   matrix:
     board:
       - esp32dev
       - your-new-board  # Add here
   ```
3. Update validation scripts to include the new board
4. Test locally before pushing

### Changing Retention Period

Edit the `retention-days` in workflow files:
```yaml
- name: Upload firmware artifact
  uses: actions/upload-artifact@v4
  with:
    retention-days: 30  # Change this value
```

### Modifying Release Notes

Edit the release notes generation section in `release.yml`:
```yaml
- name: Generate release notes
  run: |
    cat > RELEASE_NOTES.md << 'EOF'
    # Your custom release notes here
    EOF
```

## Security

### Environment Secrets
The release workflow uses the `github_release` environment which should be configured with:
- Branch protection rules
- Required reviewers (optional)
- Environment secrets (if needed)

### API Keys
**Important**: API keys should NEVER be committed to the repository.
- Use GitHub Secrets for sensitive data
- Configure API keys at runtime or via WiFiManager

## Monitoring

### Workflow Status Badges

Add these to your README:

```markdown
![PR Gate](https://github.com/vs4vijay/ESP32-Mirage/actions/workflows/pr-gate.yml/badge.svg)
![CI Build](https://github.com/vs4vijay/ESP32-Mirage/actions/workflows/ci.yml/badge.svg)
![Release](https://github.com/vs4vijay/ESP32-Mirage/actions/workflows/release.yml/badge.svg)
```

### Email Notifications

GitHub automatically sends email notifications for:
- Failed workflow runs
- Successful runs after failures

Configure in: Settings → Notifications → Actions

## Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [PlatformIO CI/CD](https://docs.platformio.org/en/latest/integration/ci/index.html)
- [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github)

## Support

For CI/CD related issues:
1. Check [GitHub Issues](https://github.com/vs4vijay/ESP32-Mirage/issues)
2. Review workflow logs in the Actions tab
3. Test builds locally with PlatformIO first
