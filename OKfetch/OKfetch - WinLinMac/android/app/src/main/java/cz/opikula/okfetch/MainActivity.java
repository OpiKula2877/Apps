package cz.opikula.okfetch;

import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import java.lang.ref.WeakReference;

/**
 * The single screen: Capacitor's WebView with the React UI, the lock cover above it, and the launchers for the
 * system screens. The core itself runs in CoreHub / CoreService and outlives this activity.
 */
public class MainActivity extends BridgeActivity {

    /** The activity is on the screen (no notifications for new messages then). */
    static volatile boolean visible;
    private static WeakReference<MainActivity> current = new WeakReference<>(null);

    private AppLock lock;
    private HostActions actions;
    private final CoreHub.EventListener settingsListener = (event) -> {
        if ("settings".equals(event.optString("type"))) runOnUiThread(this::applySettings);
    };

    static MainActivity current() {
        return current.get();
    }

    AppLock lock() {
        return lock;
    }

    HostActions actions() {
        return actions;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OkfetchPlugin.class);
        super.onCreate(savedInstanceState);
        current = new WeakReference<>(this);
        actions = new HostActions(this);
        lock = new AppLock(this);

        CoreHub hub = CoreHub.get(this);
        hub.setHostHandler(new HostRouter(this));
        hub.addEventListener(settingsListener);
        getBridge().setWebViewClient(new OkfetchWebViewClient(getBridge(), AppSettings.storageRoot(this)));

        // Draw behind the system bars and keep the page clear of them with padding (as in OKpass).
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        View content = findViewById(android.R.id.content);
        content.setBackgroundColor(AppLock.background);
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });

        applySettings();
        lock.onCreate();
        CoreService.start(this);
        LaunchQueue.handle(this, getIntent());
    }

    private void applySettings() {
        if (AppSettings.get(this).blockScreenshots) getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        if (lock != null) lock.settingsChanged();
        // Switching "Run in background" on or off changes how the service runs.
        CoreService.start(this);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        LaunchQueue.handle(this, intent);
    }

    @Override
    public void onStart() {
        super.onStart();
        current = new WeakReference<>(this);
        lock.onStart();
        CoreHub.get(this).appVisible(true);
    }

    @Override
    public void onResume() {
        super.onResume();
        visible = true;
        Notifier.get(this).cancelMessages();
    }

    @Override
    public void onPause() {
        visible = false;
        super.onPause();
    }

    @Override
    public void onStop() {
        lock.onStop();
        CoreHub.get(this).appVisible(false);
        super.onStop();
    }

    @Override
    public void onDestroy() {
        CoreHub.get(this).removeEventListener(settingsListener);
        if (current.get() == this) current = new WeakReference<>(null);
        super.onDestroy();
    }
}
