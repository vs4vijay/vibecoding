package com.syncthing.wrapped;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;

public class SyncthingService extends Service {
    private static final String TAG = "SyncthingService";
    private static final String CHANNEL_ID = "SyncthingServiceChannel";
    private static final int NOTIFICATION_ID = 1;
    
    private Process syncthingProcess;
    private PowerManager.WakeLock wakeLock;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        
        // Acquire wake lock to keep CPU running
        PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SyncthingWrapped::WakeLock");
        wakeLock.acquire();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForeground(NOTIFICATION_ID, createNotification());
        
        // Start Syncthing in a background thread
        new Thread(() -> {
            try {
                startSyncthing();
            } catch (Exception e) {
                Log.e(TAG, "Error starting Syncthing", e);
            }
        }).start();
        
        return START_STICKY; // Restart service if killed
    }

    private void startSyncthing() throws IOException {
        File syncthingBinary = extractSyncthingBinary();
        if (syncthingBinary == null || !syncthingBinary.exists()) {
            Log.e(TAG, "Syncthing binary not found");
            return;
        }

        // Make binary executable
        syncthingBinary.setExecutable(true, false);
        
        // Set up Syncthing home directory
        File syncthingHome = new File(getFilesDir(), "syncthing");
        if (!syncthingHome.exists()) {
            syncthingHome.mkdirs();
        }

        // Build command
        ProcessBuilder processBuilder = new ProcessBuilder(
                syncthingBinary.getAbsolutePath(),
                "-home", syncthingHome.getAbsolutePath(),
                "-no-browser",
                "-gui-address", "127.0.0.1:8384"
        );
        
        processBuilder.redirectErrorStream(true);
        
        try {
            syncthingProcess = processBuilder.start();
            
            // Read output in a separate thread
            new Thread(() -> {
                try (BufferedReader reader = new BufferedReader(
                        new InputStreamReader(syncthingProcess.getInputStream()))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        Log.d(TAG, "Syncthing: " + line);
                    }
                } catch (IOException e) {
                    Log.e(TAG, "Error reading Syncthing output", e);
                }
            }).start();
            
            Log.i(TAG, "Syncthing started successfully");
            
            // Wait for process to complete (it shouldn't exit normally)
            int exitCode = syncthingProcess.waitFor();
            Log.w(TAG, "Syncthing process exited with code: " + exitCode);
            
        } catch (Exception e) {
            Log.e(TAG, "Error running Syncthing", e);
        }
    }

    private File extractSyncthingBinary() {
        String abi = Build.SUPPORTED_ABIS[0];
        String binaryName = "syncthing-" + abi;
        
        // Try to find the appropriate binary
        String[] possibleNames = {
            binaryName,
            "syncthing-arm64-v8a",
            "syncthing-armeabi-v7a",
            "syncthing-x86_64",
            "syncthing-x86",
            "syncthing"
        };
        
        for (String name : possibleNames) {
            try {
                InputStream inputStream = getAssets().open(name);
                File outputFile = new File(getFilesDir(), "syncthing");
                
                try (OutputStream outputStream = new FileOutputStream(outputFile)) {
                    byte[] buffer = new byte[8192];
                    int bytesRead;
                    while ((bytesRead = inputStream.read(buffer)) != -1) {
                        outputStream.write(buffer, 0, bytesRead);
                    }
                }
                
                inputStream.close();
                Log.i(TAG, "Extracted Syncthing binary: " + name);
                return outputFile;
            } catch (IOException e) {
                Log.d(TAG, "Binary not found: " + name);
            }
        }
        
        Log.e(TAG, "No suitable Syncthing binary found for ABI: " + abi);
        return null;
    }

    private Notification createNotification() {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                notificationIntent,
                PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(getString(R.string.service_notification_title))
                .setContentText(getString(R.string.service_notification_text))
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel serviceChannel = new NotificationChannel(
                    CHANNEL_ID,
                    getString(R.string.channel_name),
                    NotificationManager.IMPORTANCE_LOW
            );
            serviceChannel.setDescription(getString(R.string.channel_description));
            
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(serviceChannel);
            }
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        
        // Stop Syncthing process
        if (syncthingProcess != null) {
            syncthingProcess.destroy();
            syncthingProcess = null;
        }
        
        // Release wake lock
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
