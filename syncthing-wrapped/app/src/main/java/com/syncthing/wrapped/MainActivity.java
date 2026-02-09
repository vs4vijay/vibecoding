package com.syncthing.wrapped;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

public class MainActivity extends AppCompatActivity {
    private static final String SYNCTHING_URL = "http://127.0.0.1:8384";
    private static final int MAX_RETRY_ATTEMPTS = 10; // Maximum number of retry attempts
    private WebView webView;
    private ProgressBar progressBar;
    private SwipeRefreshLayout swipeRefreshLayout;
    private boolean isConnected = false;
    private int retryCount = 0;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webview);
        progressBar = findViewById(R.id.progress_bar);
        swipeRefreshLayout = findViewById(R.id.swipe_refresh);

        // Check and request battery optimization exemption
        checkBatteryOptimization();

        // Configure SwipeRefreshLayout
        swipeRefreshLayout.setOnRefreshListener(() -> {
            webView.reload();
        });

        // Configure WebView
        WebSettings webSettings = webView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        webSettings.setDatabaseEnabled(true);
        webSettings.setAllowFileAccess(true);
        webSettings.setAllowContentAccess(true);
        webSettings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        webSettings.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                // Only show refresh indicator if not already refreshing (to avoid conflict with user gesture)
                if (!swipeRefreshLayout.isRefreshing()) {
                    swipeRefreshLayout.setRefreshing(true);
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                // Only mark as connected if we actually loaded the Syncthing URL successfully
                if (url != null && url.startsWith(SYNCTHING_URL) && !isConnected) {
                    isConnected = true;
                    retryCount = 0; // Reset retry count on successful connection
                    progressBar.setVisibility(View.GONE);
                    Toast.makeText(MainActivity.this, R.string.connection_status_connected, Toast.LENGTH_SHORT).show();
                }
                swipeRefreshLayout.setRefreshing(false);
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                super.onReceivedError(view, errorCode, description, failingUrl);
                swipeRefreshLayout.setRefreshing(false);
                
                if (!isConnected && retryCount < MAX_RETRY_ATTEMPTS) {
                    retryCount++;
                    // Show retry message only if not yet connected
                    Toast.makeText(MainActivity.this, R.string.connection_status_failed, Toast.LENGTH_SHORT).show();
                    // Retry loading after a delay with exponential backoff
                    long delayMs = Math.min(2000 * retryCount, 10000); // Max 10 seconds delay
                    webView.postDelayed(() -> webView.loadUrl(SYNCTHING_URL), delayMs);
                } else if (retryCount >= MAX_RETRY_ATTEMPTS) {
                    // Max retries reached
                    Toast.makeText(MainActivity.this, R.string.connection_max_retries, Toast.LENGTH_LONG).show();
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient());

        // Start Syncthing service
        startSyncthingService();

        // Show toast that service is starting
        Toast.makeText(this, R.string.service_starting, Toast.LENGTH_SHORT).show();

        // Load Syncthing web UI after a delay to allow service to start
        webView.postDelayed(() -> webView.loadUrl(SYNCTHING_URL), 3000);
    }

    private void startSyncthingService() {
        Intent serviceIntent = new Intent(this, SyncthingService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }
    }

    private void checkBatteryOptimization() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                showBatteryOptimizationDialog();
            }
        }
    }

    private void showBatteryOptimizationDialog() {
        new AlertDialog.Builder(this)
                .setTitle(R.string.battery_optimization_title)
                .setMessage(R.string.battery_optimization_message)
                .setPositiveButton(R.string.settings, (dialog, which) -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                        intent.setData(Uri.parse("package:" + getPackageName()));
                        try {
                            startActivity(intent);
                        } catch (Exception e) {
                            Toast.makeText(this, "Unable to open battery settings", Toast.LENGTH_SHORT).show();
                        }
                    }
                })
                .setNegativeButton(R.string.cancel, null)
                .show();
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            // Show exit confirmation dialog
            showExitConfirmationDialog();
        }
    }

    private void showExitConfirmationDialog() {
        new AlertDialog.Builder(this)
                .setTitle(R.string.dialog_exit_title)
                .setMessage(R.string.dialog_exit_message)
                .setPositiveButton(R.string.button_background, (dialog, which) -> {
                    // Move app to background
                    moveTaskToBack(true);
                })
                .setNegativeButton(R.string.button_close_app, (dialog, which) -> {
                    // Close app completely
                    finish();
                })
                .setCancelable(true)
                .show();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (webView != null) {
            webView.destroy();
        }
    }
}
