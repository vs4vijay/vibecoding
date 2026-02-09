# Building Syncthing Wrapped Locally

This guide provides detailed instructions for building the Syncthing Wrapped APK on your local machine for testing.

## Prerequisites

### Required Software

1. **JDK 17 or higher**
   - Download from: https://adoptium.net/
   - Verify installation: `java -version`

2. **Android SDK**
   - Install Android Studio: https://developer.android.com/studio
   - Or install command-line tools: https://developer.android.com/studio#command-tools
   - Required SDK components:
     - Android SDK Platform 34 (Android 14)
     - Android SDK Build-Tools 34.0.0 or higher
     - Android SDK Platform-Tools

3. **Git**
   - Download from: https://git-scm.com/downloads
   - Verify installation: `git --version`

### Environment Setup

Set the `ANDROID_HOME` environment variable to point to your Android SDK location:

**Linux/macOS:**
```bash
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/tools
```

**Windows:**
```cmd
set ANDROID_HOME=C:\Users\YourUsername\AppData\Local\Android\Sdk
set PATH=%PATH%;%ANDROID_HOME%\platform-tools;%ANDROID_HOME%\tools
```

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/vs4vijay/syncthing-wrapped.git
cd syncthing-wrapped
```

### 2. Download Syncthing Binaries

```bash
./scripts/download-syncthing.sh
```

This script will download the official Syncthing binaries for all supported Android architectures:
- ARM64 (arm64-v8a) - for modern 64-bit ARM devices
- ARMv7 (armeabi-v7a) - for 32-bit ARM devices
- x86_64 - for 64-bit x86 emulators/devices
- x86 - for 32-bit x86 emulators/devices

**Note:** The binaries are approximately 25MB each (total ~100MB). They are downloaded from the official Syncthing releases.

### 3. Build Debug APK

**Using the build script (Linux/macOS):**
```bash
./scripts/build.sh
```

**Or manually with Gradle:**
```bash
./gradlew assembleDebug
```

**Windows:**
```cmd
gradlew.bat assembleDebug
```

The debug APK will be located at:
```
app/build/outputs/apk/debug/app-debug.apk
```

### 4. Install on Device

**Via ADB:**
```bash
adb install app/build/outputs/apk/debug/app-debug.apk
```

**Or manually:**
- Transfer the APK to your Android device
- Enable "Install from unknown sources" in Settings
- Tap the APK file to install

## Building Release APK

For a release build:

```bash
./gradlew assembleRelease
```

The unsigned release APK will be at:
```
app/build/outputs/apk/release/app-release-unsigned.apk
```

**Note:** To sign the APK for production, you'll need to:
1. Create a keystore
2. Configure signing in `app/build.gradle`
3. Set signing credentials

## Development Tasks

### Running Lint

Check for code quality issues:
```bash
./gradlew lint
```

Lint reports will be generated in:
```
app/build/reports/lint-results.html
```

### Running Unit Tests

```bash
./gradlew test
```

Test reports will be generated in:
```
app/build/reports/tests/
```

### Cleaning Build

To clean all build artifacts:
```bash
./gradlew clean
```

## Testing on Emulator

### Create Android Virtual Device (AVD)

1. Open Android Studio
2. Go to Tools → AVD Manager
3. Create a new virtual device
4. Select a device definition (e.g., Pixel 5)
5. Select a system image (API 24 or higher)
6. Finish and launch the emulator

### Install on Emulator

```bash
adb install app/build/outputs/apk/debug/app-debug.apk
```

## Troubleshooting

### Build Fails with "SDK location not found"

Create a `local.properties` file in the project root:
```properties
sdk.dir=/path/to/your/android/sdk
```

### Gradle Sync Fails

1. Check your internet connection (Gradle needs to download dependencies)
2. Try running with `--refresh-dependencies`:
   ```bash
   ./gradlew assembleDebug --refresh-dependencies
   ```

### OutOfMemory Error

Increase Gradle's memory in `gradle.properties`:
```properties
org.gradle.jvmargs=-Xmx4096m -Dfile.encoding=UTF-8
```

### ADB Device Not Found

1. Enable USB debugging on your Android device
2. Connect via USB
3. Run `adb devices` to verify connection
4. If needed, run `adb kill-server && adb start-server`

### Syncthing Binary Download Fails

If the download script fails:
1. Check your internet connection
2. Verify the Syncthing version in the script is available
3. Manual download: Visit https://github.com/syncthing/syncthing/releases
4. Download the appropriate `syncthing-linux-{arch}-{version}.tar.gz` files
5. Extract the binaries to `app/src/main/assets/` with the naming:
   - `syncthing-arm64-v8a`
   - `syncthing-armeabi-v7a`
   - `syncthing-x86_64`
   - `syncthing-x86`

## Architecture-Specific Builds

To build for specific architectures only (reduces APK size):

Edit `app/build.gradle` and modify the `ndk.abiFilters`:

```gradle
ndk {
    abiFilters 'arm64-v8a'  // Only build for ARM64
}
```

## Continuous Integration

The project includes a GitHub Actions workflow (`.github/workflows/android-ci.yml`) that:
- Automatically builds APKs on every push/PR
- Runs lint checks
- Runs unit tests
- Uploads APK artifacts

View the CI results at: https://github.com/vs4vijay/syncthing-wrapped/actions

## Next Steps

After building successfully:
1. Install the APK on your device
2. Launch "Syncthing Wrapped"
3. Grant required permissions
4. Disable battery optimization when prompted
5. Wait for Syncthing to start (3-5 seconds)
6. Configure your sync folders through the web UI

## Getting Help

If you encounter issues:
1. Check the [main README](README.md) for common issues
2. View logs: `adb logcat | grep Syncthing`
3. Open an issue on GitHub: https://github.com/vs4vijay/syncthing-wrapped/issues

## References

- [Android Developer Guide](https://developer.android.com/guide)
- [Gradle Build Tool](https://gradle.org/)
- [Syncthing Documentation](https://docs.syncthing.net/)
