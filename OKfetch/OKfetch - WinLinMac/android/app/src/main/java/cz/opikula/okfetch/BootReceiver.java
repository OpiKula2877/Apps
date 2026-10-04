package cz.opikula.okfetch;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** After a restart of the phone, start receiving again when "Run in background" is on. */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        // Only BOOT_COMPLETED may start a foreground service from the background (Android 14+).
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        if (AppSettings.get(context).backgroundService) CoreService.start(context);
    }
}
