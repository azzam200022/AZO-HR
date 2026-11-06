package com.azzam200022.azo;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.ActivityManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.webkit.CookieManager;

import org.json.JSONObject;
import org.json.JSONArray;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

public class BackgroundLocationService extends Service implements LocationListener {
    public static final String ACTION_START = "com.azzam200022.azo.START_BACKGROUND_TRACKING";
    public static final String ACTION_STOP = "com.azzam200022.azo.STOP_BACKGROUND_TRACKING";
    public static final String EXTRA_API_BASE_URL = "apiBaseUrl";
    public static final String EXTRA_EMPLOYEE_ID = "employeeId";
    private static final String CHANNEL_ID = "azo-work-location";
    private static final int NOTIFICATION_ID = 8214;
    private static final String PREFS = "azo_background_location";
    private static final long UPDATE_INTERVAL_MS = 5_000L;
    private static final long MIN_SEND_INTERVAL_MS = 5_000L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final AtomicBoolean flushInFlight = new AtomicBoolean(false);
    private final Runnable syncRetry = new Runnable() {
        @Override
        public void run() {
            scheduleFlush();
            handler.postDelayed(this, 30_000L);
        }
    };

    private LocationManager locationManager;
    private LocationQueueDatabase locationQueue;
    private String apiBaseUrl = "";
    private String employeeId = "";
    private long lastSentAt;
    private boolean updatesRequested;

    @Override
    public void onCreate() {
        super.onCreate();
        locationManager = (LocationManager) getSystemService(LOCATION_SERVICE);
        locationQueue = new LocationQueueDatabase(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            getSharedPreferences(PREFS, MODE_PRIVATE)
                .edit()
                .putBoolean("manual_stopped", true)
                .apply();
            stopTracking();
            return START_NOT_STICKY;
        }

        SharedPreferences preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (intent != null && ACTION_START.equals(intent.getAction())) {
            apiBaseUrl = normalizeOrigin(intent.getStringExtra(EXTRA_API_BASE_URL));
            employeeId = intent.getStringExtra(EXTRA_EMPLOYEE_ID);
            if (employeeId == null) employeeId = "";
            preferences.edit()
                .putString(EXTRA_API_BASE_URL, apiBaseUrl)
                .putString(EXTRA_EMPLOYEE_ID, employeeId)
                .putBoolean("active", true)
                .putBoolean("manual_stopped", false)
                .apply();
        } else {
            if (!preferences.getBoolean("active", false)) {
                stopSelf();
                return START_NOT_STICKY;
            }
            apiBaseUrl = normalizeOrigin(preferences.getString(EXTRA_API_BASE_URL, ""));
            employeeId = preferences.getString(EXTRA_EMPLOYEE_ID, "");
        }

        if (apiBaseUrl.isEmpty() || employeeId.isEmpty()) {
            stopTracking();
            return START_NOT_STICKY;
        }

        if (!hasLocationPermission()) {
            stopTracking();
            return START_NOT_STICKY;
        }

        createNotificationChannel();
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            );
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        requestLocationUpdates();
        if (!updatesRequested) {
            stopTracking();
            return START_NOT_STICKY;
        }

        scheduleFlush();
        handler.removeCallbacks(syncRetry);
        handler.postDelayed(syncRetry, 30_000L);
        return START_STICKY;
    }

    private static String normalizeOrigin(String value) {
        if (value == null) return "";
        String origin = value.trim();
        while (origin.endsWith("/")) {
            origin = origin.substring(0, origin.length() - 1);
        }
        if (origin.endsWith("/api")) {
            origin = origin.substring(0, origin.length() - 4);
        }
        return origin;
    }

    private boolean hasLocationPermission() {
        boolean fine = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
        boolean coarse = checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
        return fine || coarse;
    }

    @SuppressLint("MissingPermission")
    private void requestLocationUpdates() {
        updatesRequested = false;
        if (locationManager == null || !hasLocationPermission()) return;

        for (String provider : new String[] {
            LocationManager.GPS_PROVIDER,
            LocationManager.NETWORK_PROVIDER
        }) {
            try {
                if (locationManager.isProviderEnabled(provider)) {
                    locationManager.requestLocationUpdates(
                        provider,
                        UPDATE_INTERVAL_MS,
                        0f,
                        this,
                        Looper.getMainLooper()
                    );
                    updatesRequested = true;
                }
            } catch (Exception ignored) {
                // GPS or network location may be disabled or unavailable on this device.
            }
        }
    }

    @Override
    public void onLocationChanged(Location location) {
        if (location == null) return;
        long now = System.currentTimeMillis();
        if (now - lastSentAt < MIN_SEND_INTERVAL_MS) return;
        lastSentAt = now;
        getSharedPreferences(PREFS, MODE_PRIVATE)
            .edit()
            .putLong("lastSentAt", now)
            .apply();
        try {
            locationQueue.enqueue(employeeId, location);
        } catch (Exception exception) {
            android.util.Log.w("AzoBackgroundLocation", "Could not save a location fix");
            return;
        }
        scheduleFlush();
    }

    private void scheduleFlush() {
        if (!flushInFlight.compareAndSet(false, true)) return;
        network.execute(() -> {
            try {
                flushPending();
            } finally {
                flushInFlight.set(false);
            }
        });
    }

    private void flushPending() {
        if (locationQueue == null || apiBaseUrl.isEmpty() || employeeId.isEmpty()) return;
        boolean checkedOut = false;
        while (true) {
            HttpURLConnection connection = null;
            try {
                JSONArray samples = locationQueue.readBatch(employeeId, 100);
                if (samples.length() == 0) break;

                String cookie = CookieManager.getInstance().getCookie(apiBaseUrl + "/");
                if (cookie == null || cookie.isEmpty()) {
                    requestStop();
                    return;
                }

                URL endpoint = new URL(apiBaseUrl + "/api/me/presence/batch");
                connection = (HttpURLConnection) endpoint.openConnection();
                connection.setRequestMethod("POST");
                connection.setConnectTimeout(15_000);
                connection.setReadTimeout(15_000);
                connection.setDoOutput(true);
                connection.setRequestProperty("Cookie", cookie);
                connection.setRequestProperty("Content-Type", "application/json");

                JSONObject body = new JSONObject();
                body.put("samples", samples);
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(bytes);
                }

                int status = connection.getResponseCode();
                if (status == HttpURLConnection.HTTP_UNAUTHORIZED
                    || status == HttpURLConnection.HTTP_FORBIDDEN
                    || status == HttpURLConnection.HTTP_NOT_FOUND
                    || status == HttpURLConnection.HTTP_CONFLICT) {
                    requestStop();
                    return;
                }

                if (status < 200 || status >= 300) {
                    android.util.Log.w("AzoBackgroundLocation", "Location batch sync failed");
                    return;
                }

                try (InputStream input = connection.getInputStream()) {
                    ByteArrayOutputStream responseBytes = new ByteArrayOutputStream();
                    byte[] buffer = new byte[1024];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        responseBytes.write(buffer, 0, count);
                    }
                    JSONObject result = new JSONObject(
                        new String(responseBytes.toByteArray(), StandardCharsets.UTF_8)
                    );
                    JSONArray acknowledged = result.optJSONArray("acknowledged_ids");
                    if (acknowledged == null || acknowledged.length() == 0) return;
                    locationQueue.deleteAcknowledged(employeeId, acknowledged);
                    checkedOut = checkedOut || result.optBoolean("checked_out", false);
                }
            } catch (Exception exception) {
                // Never log coordinates, cookies, or the request URL.
                android.util.Log.w("AzoBackgroundLocation", "Location batch sync failed");
                return;
            } finally {
                if (connection != null) connection.disconnect();
            }
        }
        if (checkedOut) requestStop();
    }

    private void requestStop() {
        handler.post(this::stopTracking);
    }

    private Notification buildNotification() {
        Intent stopIntent = new Intent(this, BackgroundLocationService.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stopPendingIntent = PendingIntent.getService(
            this,
            0,
            stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        builder.setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("مواردي — تتبع موقع الدوام")
            .setContentText("تُحفظ النقاط عند انقطاع الإنترنت وتُرسل عند عودته.")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(
                android.R.drawable.ic_media_pause,
                "إيقاف التتبع",
                stopPendingIntent
            );
        return builder.build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager =
            (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "تتبع موقع الدوام",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("إشعار ظاهر ما دام تتبع الموقع أثناء الدوام مفعّلاً.");
        manager.createNotificationChannel(channel);
    }

    private void stopTracking() {
        handler.removeCallbacks(syncRetry);
        if (locationManager != null) {
            try {
                locationManager.removeUpdates(this);
            } catch (Exception ignored) {
                // The service may be stopping before location updates were registered.
            }
        }
        getSharedPreferences(PREFS, MODE_PRIVATE)
            .edit()
            .putBoolean("active", false)
            .remove(EXTRA_API_BASE_URL)
            .remove(EXTRA_EMPLOYEE_ID)
            .apply();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        stopSelf();
    }

    public static boolean isRunning(Context context) {
        ActivityManager manager =
            (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        if (manager == null) return false;
        List<ActivityManager.RunningServiceInfo> services =
            manager.getRunningServices(Integer.MAX_VALUE);
        for (ActivityManager.RunningServiceInfo service : services) {
            if (BackgroundLocationService.class.getName().equals(service.service.getClassName())) {
                return true;
            }
        }
        return false;
    }

    public static boolean wasManuallyStopped(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean("manual_stopped", false);
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(syncRetry);
        if (locationManager != null) {
            try {
                locationManager.removeUpdates(this);
            } catch (Exception ignored) {
                // Ignore cleanup failures during process shutdown.
            }
        }
        if (locationQueue != null) locationQueue.close();
        network.shutdownNow();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onProviderEnabled(String provider) {}

    @Override
    public void onProviderDisabled(String provider) {}

    @Override
    @SuppressWarnings("deprecation")
    public void onStatusChanged(String provider, int status, android.os.Bundle extras) {}
}
