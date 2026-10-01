package cz.opikula.okpass;

import android.graphics.Color;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Matches the area behind the status and navigation bars to the selected theme. */
@CapacitorPlugin(name = "OkpassWindow")
public class OkpassWindowPlugin extends Plugin {

    @PluginMethod
    public void setColors(PluginCall call) {
        String background = call.getString("background", "#0E0A0A");
        boolean light = Boolean.TRUE.equals(call.getBoolean("light", false));
        getActivity().runOnUiThread(() -> {
            try {
                int color = Color.parseColor(background);
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
