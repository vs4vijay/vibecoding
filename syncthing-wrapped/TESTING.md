# Testing Syncthing Wrapped

This guide explains how to test the Syncthing Wrapped app after building it.

## Pre-Testing Checklist

Before testing, ensure:
- [ ] You have built the APK successfully (see [BUILDING.md](BUILDING.md))
- [ ] You have an Android device running Android 7.0 (API 24) or higher
- [ ] USB debugging is enabled on your device (for ADB installation)
- [ ] The device has sufficient storage space (at least 100MB free)

## Installation Testing

### 1. Install via ADB

```bash
adb install app/build/outputs/apk/debug/app-debug.apk
```

**Expected Result:** Installation succeeds without errors.

**Troubleshooting:**
- If "INSTALL_FAILED_UPDATE_INCOMPATIBLE", uninstall old version first:
  ```bash
  adb uninstall com.syncthing.wrapped.debug
  ```

### 2. Verify Installation

```bash
adb shell pm list packages | grep syncthing
```

**Expected Output:**
```
package:com.syncthing.wrapped.debug
```

## Functional Testing

### Test 1: App Launch

1. **Action:** Tap the "Syncthing Wrapped" icon in the app drawer
2. **Expected Result:**
   - App launches without crashing
   - Progress bar shows briefly
   - Battery optimization dialog appears (first launch only)

### Test 2: Battery Optimization

1. **Action:** When prompted, tap "Settings" on the battery optimization dialog
2. **Expected Result:**
   - System battery settings open
   - You can disable battery optimization for the app
3. **Action:** Disable battery optimization and return to app
4. **Expected Result:**
   - App continues to load

### Test 3: Syncthing Service

1. **Action:** Wait 3-5 seconds after app launch
2. **Expected Result:**
   - WebView loads with Syncthing UI
   - Syncthing web interface appears at http://127.0.0.1:8384
   - Progress bar disappears

**Check via ADB:**
```bash
adb logcat | grep Syncthing
```

**Expected Logs:**
```
SyncthingService: Syncthing started successfully
SyncthingService: Syncthing: [INFO] ...
```

### Test 4: Foreground Service

1. **Action:** Navigate to home screen (don't close app)
2. **Action:** Pull down notification shade
3. **Expected Result:**
   - "Syncthing Wrapped" notification is visible
   - Notification text: "Syncthing is running"
   - Notification is persistent (can't be dismissed)

**Check via ADB:**
```bash
adb shell dumpsys notification | grep "Syncthing"
```

### Test 5: WebView Functionality

1. **Action:** In the app, navigate through Syncthing's interface
2. **Test Actions:**
   - Tap on different menu items
   - Try to add a folder
   - Try to add a device
3. **Expected Result:**
   - WebView is responsive
   - JavaScript works correctly
   - No crashes or freezes

### Test 6: Background Operation

1. **Action:** Use the app for 1-2 minutes
2. **Action:** Press home button
3. **Action:** Wait 5 minutes
4. **Action:** Check if service is still running:
   ```bash
   adb shell ps | grep syncthing
   ```
5. **Expected Result:**
   - Syncthing process is still running
   - Service has not been killed by OS

### Test 7: App Resume

1. **Action:** With app in background, reopen it
2. **Expected Result:**
   - WebView retains its state
   - Syncthing UI loads instantly
   - No need to restart service

### Test 8: Configuration Persistence

1. **Action:** In Syncthing UI, add a device or folder
2. **Action:** Close app completely (swipe away from recent apps)
3. **Action:** Wait 10 seconds
4. **Action:** Reopen app
5. **Expected Result:**
   - Previous configuration is retained
   - Added device/folder is still there

### Test 9: Device Architecture

Verify correct binary is being used:

```bash
adb shell "cat /proc/cpuinfo | grep -i abi"
```

Then check which binary was extracted:

```bash
adb logcat | grep "Extracted Syncthing binary"
```

**Expected:** Binary name matches device architecture.

### Test 10: Memory Usage

Monitor memory usage over time:

```bash
adb shell dumpsys meminfo com.syncthing.wrapped.debug
```

**Expected:** Memory usage is stable and reasonable (<200MB for typical usage).

## Performance Testing

### Test 11: File Sync Performance

1. **Setup:** Configure sync with another device
2. **Action:** Sync a folder with test files
3. **Monitor:**
   ```bash
   adb logcat | grep -i sync
   ```
4. **Expected Result:**
   - Files sync successfully
   - No significant lag or freezing
   - CPU usage is reasonable

### Test 12: Network Usage

Monitor network activity:

```bash
adb shell dumpsys netstats | grep com.syncthing.wrapped
```

**Expected:** Network usage corresponds to sync activity.

## Stress Testing

### Test 13: Long-Running Service

1. **Action:** Let app run for 24 hours
2. **Check periodically:**
   - Is service still running?
   - Is memory usage stable?
   - Is battery drain acceptable?
3. **Expected Result:**
   - Service remains active
   - No memory leaks
   - Battery drain is reasonable

### Test 14: App Kill Recovery

1. **Action:** Force stop the app:
   ```bash
   adb shell am force-stop com.syncthing.wrapped.debug
   ```
2. **Action:** Reopen the app
3. **Expected Result:**
   - App restarts cleanly
   - Service restarts automatically
   - Configuration is intact

### Test 15: Low Battery

1. **Action:** Test app when battery is below 20%
2. **Expected Result:**
   - App continues to function
   - No unexpected battery optimization kicks in

## Regression Testing

### Test 16: Orientation Change

1. **Action:** Rotate device while app is open
2. **Expected Result:**
   - WebView adapts to new orientation
   - Content is not lost
   - No crash

### Test 17: Back Button

1. **Action:** In Syncthing UI, navigate to a sub-page
2. **Action:** Press back button
3. **Expected Result:**
   - WebView goes back to previous page
   - When at home page, pressing back exits app

### Test 18: Multi-Window Mode (Android 7.0+)

1. **Action:** Enter split-screen mode with another app
2. **Expected Result:**
   - App functions correctly in split view
   - WebView renders properly

## Security Testing

### Test 19: Network Configuration

1. **Check:** Verify cleartext traffic is only allowed for localhost
2. **Test:** Try accessing external HTTP (non-HTTPS) sites in WebView
3. **Expected:** Only localhost:8384 is accessible via HTTP

### Test 20: Permissions

```bash
adb shell dumpsys package com.syncthing.wrapped.debug | grep permission
```

**Verify:** Only required permissions are granted.

## Automated Testing

### Run Unit Tests

```bash
./gradlew test
```

**Expected:** All tests pass.

### Run Lint Checks

```bash
./gradlew lint
```

**Expected:** No critical issues.

## Test Report Template

Use this template to document your testing:

```markdown
## Test Session Report

**Date:** YYYY-MM-DD
**Tester:** Your Name
**Device:** Make/Model
**Android Version:** X.X
**APK Version:** 1.0.0
**Build Type:** Debug/Release

### Test Results

| Test # | Test Name | Status | Notes |
|--------|-----------|--------|-------|
| 1 | App Launch | ✅ Pass | |
| 2 | Battery Opt | ✅ Pass | |
| ... | ... | ... | ... |

### Issues Found

1. **Issue Title**
   - Severity: High/Medium/Low
   - Description: ...
   - Steps to Reproduce: ...
   - Expected: ...
   - Actual: ...

### Overall Assessment

- [ ] Ready for release
- [ ] Needs fixes
- [ ] Blocked by: ...
```

## Debugging Tips

### View All Logs

```bash
adb logcat -c  # Clear logs
adb logcat | grep -i "syncthing\|wrapped\|AndroidRuntime"
```

### Check Service Status

```bash
adb shell dumpsys activity services | grep Syncthing
```

### Check Wake Locks

```bash
adb shell dumpsys power | grep -i syncthing
```

### Monitor CPU Usage

```bash
adb shell top | grep syncthing
```

### Capture Bug Report

```bash
adb bugreport bugreport.zip
```

## Known Issues

Document any known issues here:

1. **First launch delay**: Syncthing takes 3-5 seconds to start (expected behavior)
2. **Battery usage**: Higher battery consumption expected during active sync

## Reporting Issues

When reporting issues, include:
1. Test number and description
2. Device information
3. Android version
4. Logs from `adb logcat`
5. Steps to reproduce
6. Expected vs actual behavior
7. Screenshots/screen recordings if applicable

## CI Testing

The GitHub Actions workflow automatically runs:
- Lint checks
- Unit tests
- Build verification

View results at: https://github.com/vs4vijay/syncthing-wrapped/actions
