package cz.opikula.okfetch;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

/**
 * Keeps the core alive without the screen. With "Run in background" on it is a foreground service with a
 * permanent notification (so Android does not kill it); with the option off it only lives while the app is
 * open and stops one minute after the app leaves the screen (CoreHub.appVisible).
 */
public class CoreService extends Service {

    private static final String TAG = "OKfetch";

    static void start(Context context) {
        Intent intent = new Intent(context, CoreService.class);
        try {
            if (AppSettings.get(context).backgroundService) ContextCompat.startForegroundService(context, intent);
            else context.startService(intent);
        } catch (Exception error) {
            // Android refuses to start services from the background in some states; the hub still runs in-process.
            Log.w(TAG, "cannot start the service", error);
            CoreHub.get(context).start();
        }
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, CoreService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        Notifier.get(this).ensureChannels();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        CoreHub.get(this).start();
        if (AppSettings.get(this).backgroundService) {
            int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE : 0;
            ServiceCompat.startForeground(this, Notifier.SERVICE_ID, Notifier.get(this).serviceNotification(), type);
            return START_STICKY;
        }
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
