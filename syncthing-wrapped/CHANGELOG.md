# Changelog

All notable changes to Syncthing Wrapped will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial Android app structure
- WebView integration for Syncthing UI
- Foreground service for persistent operation
- Battery optimization handling
- Wake lock management
- Multi-architecture support (ARM64, ARMv7, x86_64, x86)
- Download script for Syncthing binaries
- GitHub Actions CI/CD pipeline
- PR gate workflow
- Comprehensive documentation (README, BUILDING, TESTING, CONTRIBUTING)
- Build scripts for easy local development

### Changed
- Nothing yet

### Deprecated
- Nothing yet

### Removed
- Nothing yet

### Fixed
- Nothing yet

### Security
- Network security configuration for localhost cleartext traffic

## [1.0.0] - TBD

### Added
- First stable release
- Complete Android wrapper for Syncthing
- Support for Android 7.0+ (API 24+)
- Syncthing v1.27.2 binaries

---

## Release Notes

### Version 1.0.0 (Planned)

**Highlights:**
- Run Syncthing natively on Android
- Beautiful WebView interface
- Background service keeps Syncthing running
- Battery optimization management
- Easy setup and configuration

**Requirements:**
- Android 7.0 (Nougat) or higher
- Minimum 100MB storage space
- Internet connection for initial setup

**Known Limitations:**
- First launch takes 3-5 seconds for Syncthing to start
- Battery usage may be higher during active sync
- Requires battery optimization to be disabled for best performance

**Download:**
- Will be available from GitHub Releases
- Can be built from source (see BUILDING.md)

**Installation:**
```bash
adb install app-debug.apk
```

**What's Next:**
- Play Store release (if applicable)
- Additional customization options
- Performance improvements
- More comprehensive testing

---

## Versioning Strategy

- **Major (X.0.0)**: Breaking changes, major feature additions
- **Minor (1.X.0)**: New features, non-breaking changes
- **Patch (1.0.X)**: Bug fixes, minor improvements

## How to Update

When a new version is released:
1. Download the APK from GitHub Releases
2. Install over the existing version (if updating)
3. Launch the app - settings should be preserved

## Reporting Issues

Found a bug? Please report it:
- Check existing issues first
- Include version number, device info, and logs
- Follow the bug report template
- https://github.com/vs4vijay/syncthing-wrapped/issues

## Contributing

Want to help improve Syncthing Wrapped?
- See [CONTRIBUTING.md](CONTRIBUTING.md)
- Check open issues for things to work on
- Submit pull requests with improvements

Thank you for using Syncthing Wrapped!
