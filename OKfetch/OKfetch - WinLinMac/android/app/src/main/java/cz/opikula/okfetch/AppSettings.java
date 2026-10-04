package cz.opikula.okfetch;

import android.content.Context;
import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/**
 * The few settings Java needs before the core runs (lock, screenshots, background service, notifications).
 * The core owns settings.json; Java reads it at start and follows the "settings" events afterwards.
 */
final class AppSettings {

    final boolean appLock;
    final int lockAfterMinutes;
    final boolean backgroundService;
    final boolean blockScreenshots;
    final boolean hideNotificationContent;
    final boolean notifications;
    final boolean czech;

    private static volatile AppSettings current;

    private AppSettings(JSONObject json) {
        appLock = json.optBoolean("app_lock", false);
        int after = json.optInt("lock_after", 1);
        lockAfterMinutes = (after == 0 || after == 1 || after == 5 || after == 15) ? after : 1;
        backgroundService = json.optBoolean("background_service", true);
        blockScreenshots = json.optBoolean("block_screenshots", true);
        hideNotificationContent = json.optBoolean("hide_notification_content", false);
        notifications = json.optBoolean("notifications", true);
        czech = !"en".equals(json.optString("language", "cs"));
    }

    static File configDir(Context context) {
        return new File(context.getFilesDir(), "config");
    }

    static File storageRoot(Context context) {
        return new File(context.getFilesDir(), "okfetch");
    }

    static AppSettings get(Context context) {
        AppSettings settings = current;
        if (settings == null) {
            settings = new AppSettings(read(new File(configDir(context), "settings.json")));
            current = settings;
        }
        return settings;
    }

    /** Called with the settings the core just saved. */
    static AppSettings update(JSONObject json) {
        AppSettings settings = new AppSettings(json);
        current = settings;
        return settings;
    }

    /** Czech or English text, following the app language. */
    String text(String cs, String en) {
        return czech ? cs : en;
    }

    private static JSONObject read(File file) {
        try (FileInputStream in = new FileInputStream(file)) {
            byte[] data = new byte[(int) file.length()];
            int read = 0;
            while (read < data.length) {
                int n = in.read(data, read, data.length - read);
                if (n < 0) break;
                read += n;
            }
            return new JSONObject(new String(data, 0, read, StandardCharsets.UTF_8));
        } catch (Exception missing) {
            return new JSONObject();
        }
    }
}
