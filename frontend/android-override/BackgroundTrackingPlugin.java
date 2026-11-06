package com.azzam200022.azo;

import android.content.Intent;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BackgroundTracking")
public class BackgroundTrackingPlugin extends Plugin {
    @PluginMethod
    public void start(PluginCall call) {
        String apiBaseUrl = call.getData().optString("apiBaseUrl", "").trim();
        String employeeId = call.getData().optString("employeeId", "").trim();
        if (apiBaseUrl.isEmpty() || employeeId.isEmpty()) {
            call.reject("تعذر إعداد رابط الخادم أو حساب الموظف.");
            return;
        }

        Intent intent = new Intent(getContext(), BackgroundLocationService.class);
        intent.setAction(BackgroundLocationService.ACTION_START);
        intent.putExtra(BackgroundLocationService.EXTRA_API_BASE_URL, apiBaseUrl);
        intent.putExtra(BackgroundLocationService.EXTRA_EMPLOYEE_ID, employeeId);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ContextCompat.startForegroundService(getContext(), intent);
            } else {
                getContext().startService(intent);
            }
            JSObject result = new JSObject();
            result.put("active", true);
            call.resolve(result);
        } catch (Exception exception) {
            call.reject("تعذر بدء تتبع الموقع بالخلفية.", exception);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), BackgroundLocationService.class);
        intent.setAction(BackgroundLocationService.ACTION_STOP);
        getContext().startService(intent);
        JSObject result = new JSObject();
        result.put("active", false);
        call.resolve(result);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("active", BackgroundLocationService.isRunning(getContext()));
        result.put("manuallyStopped", BackgroundLocationService.wasManuallyStopped(getContext()));
        call.resolve(result);
    }
}
