# Quick Start Guide

Get Syncthing Wrapped running on your Android device in 5 minutes!

## Prerequisites

✅ Android device running Android 7.0 or higher  
✅ USB cable (for ADB installation) OR file transfer capability  
✅ Development machine with JDK 17+ and Android SDK

## Option 1: Build Locally (Recommended)

### Step 1: Clone and Setup
```bash
git clone https://github.com/vs4vijay/syncthing-wrapped.git
cd syncthing-wrapped
```

### Step 2: Download Syncthing Binaries
```bash
./scripts/download-syncthing.sh
```
*This downloads ~100MB of Syncthing binaries*

### Step 3: Build APK
```bash
./gradlew assembleDebug
```
*First build may take 2-3 minutes*

### Step 4: Install on Device
```bash
adb install app/build/outputs/apk/debug/app-debug.apk
```

### Step 5: Launch and Configure
1. Open "Syncthing Wrapped" on your device
2. Grant all requested permissions
3. Tap "Settings" when prompted for battery optimization
4. Wait 3-5 seconds for Syncthing to start
5. Configure sync folders through the web interface

**Done! 🎉**

## Option 2: Download from CI (When Available)

1. Go to [GitHub Actions](https://github.com/vs4vijay/syncthing-wrapped/actions)
2. Click on the latest successful workflow run
3. Download the `app-debug` artifact
4. Extract the APK from the zip file
5. Transfer to your device and install
6. Follow Step 5 from Option 1

## Option 3: Manual Build Script

Use the convenient build script:
```bash
./scripts/build.sh
```

This automatically downloads binaries and builds the APK.

## Troubleshooting

### "Installation blocked"
Enable "Install from unknown sources" in your device settings.

### "App keeps crashing"
Check that you granted all permissions and disabled battery optimization.

### "Can't build - SDK not found"
Set ANDROID_HOME environment variable:
```bash
export ANDROID_HOME=/path/to/android/sdk
```

### "Syncthing won't start"
1. Check logs: `adb logcat | grep Syncthing`
2. Verify binary was extracted correctly
3. Restart the app

## Next Steps

### Configure Syncthing
1. In the web UI, tap "Actions" → "Settings"
2. Add folders you want to sync
3. Add devices you want to sync with
4. Configure sync options

### Optimize Performance
1. Disable battery optimization (app prompts you)
2. Allow app to run in background
3. Disable manufacturer-specific battery saving

### Keep Updated
- Star the repository for updates
- Watch for new releases
- Pull latest changes: `git pull`

## Key Features

- ✅ Runs native Syncthing
- ✅ Persistent background operation
- ✅ Full web UI access
- ✅ Multi-architecture support
- ✅ Battery optimization handling

## Getting Help

- 📖 [Full Documentation](README.md)
- 🔨 [Build Guide](BUILDING.md)
- 🧪 [Testing Guide](TESTING.md)
- 💡 [GitHub Issues](https://github.com/vs4vijay/syncthing-wrapped/issues)

## What You Get

After installation:
- Native Android app named "Syncthing Wrapped"
- Foreground service notification
- Access to Syncthing at http://127.0.0.1:8384
- Full sync capabilities
- Persistent operation

## Requirements Summary

**Device:**
- Android 7.0+ (API 24+)
- 100MB+ free storage
- ARM, x86, or x86_64 processor

**Build Machine:**
- JDK 17+
- Android SDK (API 34)
- Gradle 8.2+
- 200MB+ free storage

## Time Estimates

- First-time setup: 5-10 minutes
- Binary download: 2-3 minutes
- APK build: 2-3 minutes
- Installation: 1 minute
- Configuration: 5-10 minutes

**Total: ~15-30 minutes from zero to syncing**

## Support

Questions? Issues? Contributions?
- Check [CONTRIBUTING.md](CONTRIBUTING.md)
- Open an [issue](https://github.com/vs4vijay/syncthing-wrapped/issues)
- Read the [documentation](README.md)

---

**Ready to start?** Run these commands:
```bash
git clone https://github.com/vs4vijay/syncthing-wrapped.git
cd syncthing-wrapped
./scripts/download-syncthing.sh
./gradlew assembleDebug
adb install app/build/outputs/apk/debug/app-debug.apk
```

Happy syncing! 🚀
