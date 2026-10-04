package cz.opikula.okfetch;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.Window;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * The WebView side of the bridge. `send` passes a line to the core; lines from the core come back as "line"
 * events. The rest are phone things the core does not handle: the lock, the QR scanner, battery and bar colours.
 */
@CapacitorPlugin(
    name = "Okfetch",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class OkfetchPlugin extends Plugin {

    private CoreHub hub;

    @Override
    public void load() {
        hub = CoreHub.get(getContext());
        hub.setWebListener((line) -> {
            JSObject data = new JSObject();
            data.put("line", line);
            notifyListeners("line", data);
        });
        LaunchQueue.setListener(() -> notifyListeners("launch", new JSObject()));
        hub.start();
    }

    @Override
    protected void handleOnDestroy() {
        hub.setWebListener(null);
        LaunchQueue.setListener(null);
    }

    @PluginMethod(returnType = PluginMethod.RETURN_NONE)
    public void send(PluginCall call) {
        String line = call.getString("line");
        if (line != null) hub.sendFromWeb(line);
    }

    /** What the app was opened for (notification, share, okfetch: link); taken once. */
    @PluginMethod
    public void takeLaunch(PluginCall call) {
        JSObject out = new JSObject();
        try {
            out.put("items", new JSArray(LaunchQueue.take().toString()));
        } catch (Exception error) {
            out.put("items", new JSArray());
        }
        call.resolve(out);
    }

    @PluginMethod
    public void lockInfo(PluginCall call) {
        JSObject out = new JSObject();
        out.put("availability", AppLock.availability(getContext()));
        call.resolve(out);
    }

    /** One fingerprint / PIN check, used before the lock is switched on. */
    @PluginMethod
    public void verifyLock(PluginCall call) {
        MainActivity activity = MainActivity.current();
        if (activity == null) {
            call.resolve(new JSObject().put("ok", false));
            return;
        }
        activity.runOnUiThread(() -> activity.lock().verify((ok) -> call.resolve(new JSObject().put("ok", ok))));
    }

    @PluginMethod
    public void scanQr(PluginCall call) {
        MainActivity activity = MainActivity.current();
        if (activity == null) {
            call.resolve(new JSObject());
            return;
        }
        activity.runOnUiThread(() -> activity.actions().scanQr((text) -> {
            JSObject out = new JSObject();
            if (text != null) out.put("text", text);
            call.resolve(out);
        }));
    }

    @PluginMethod
    public void batteryInfo(PluginCall call) {
        PowerManager power = (PowerManager) getContext().getSystemService(android.content.Context.POWER_SERVICE);
        JSObject out = new JSObject();
        out.put("optimized", !power.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        call.resolve(out);
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        MainActivity activity = MainActivity.current();
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getContext().getPackageName()));
            if (activity != null) {
                activity.lock().allowExternal();
                activity.startActivity(intent);
            }
        } catch (Exception error) {
            try {
                if (activity != null) activity.startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
            } catch (Exception ignored) {
                // no settings screen
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void notificationsInfo(PluginCall call) {
        boolean granted = Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        call.resolve(new JSObject().put("granted", granted));
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            call.resolve(new JSObject().put("granted", true));
            return;
        }
        MainActivity activity = MainActivity.current();
        if (activity != null) activity.lock().allowExternal();
        requestPermissionForAlias("notifications", call, "notificationsResult");
    }

    @PermissionCallback
    private void notificationsResult(PluginCall call) {
        MainActivity activity = MainActivity.current();
        if (activity != null) activity.lock().endExternal();
        boolean granted = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        call.resolve(new JSObject().put("granted", granted));
    }

    /** Match the system bars (and the lock cover) to the theme. */
    @PluginMethod
    public void setBarColors(PluginCall call) {
        String background = call.getString("background", "#0E0A0A");
        String text = call.getString("text", "#F2ECEC");
        boolean light = Boolean.TRUE.equals(call.getBoolean("light", false));
        getActivity().runOnUiThread(() -> {
            try {
                int color = Color.parseColor(background);
                AppLock.background = color;
                AppLock.foreground = Color.parseColor(text);
                Window window = getActivity().getWindow();
                getActivity().findViewById(android.R.id.content).setBackgroundColor(color);
                WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
                controller.setAppearanceLightStatusBars(light);
                controller.setAppearanceLightNavigationBars(light);
                call.resolve();
            } catch (IllegalArgumentException error) {
                call.reject("Bad colour", "ERROR", error);
            }
        });
    }
}
