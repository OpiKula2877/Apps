package cz.opikula.okfetch;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Build;
import android.os.SystemClock;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;

/**
 * App lock: a native cover above the WebView, so nothing of the app shows until the fingerprint (or the device
 * PIN/pattern) is confirmed. It locks on start and when the app comes back after "Lock after" minutes away.
 * Screens the app opens itself (file picker, camera, share sheet) do not count as leaving.
 */
final class AppLock {

    interface Result {
        void done(boolean ok);
    }

    /** Background colour of the current theme (set by the UI), used by the cover. */
    static volatile int background = Color.parseColor("#0E0A0A");
    static volatile int foreground = Color.parseColor("#F2ECEC");

    private final MainActivity activity;
    private View cover;
    private boolean locked;
    private boolean prompting;
    private long hiddenAt;
    private long externalUntil;
    private final OnBackPressedCallback backWhileLocked = new OnBackPressedCallback(false) {
        @Override
        public void handleOnBackPressed() {
            activity.moveTaskToBack(true);
        }
    };

    AppLock(MainActivity activity) {
        this.activity = activity;
    }

    static int authenticators() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
            ? BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL
            : BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
    }

    /** 'ok', 'none' (no fingerprint and no screen lock set up) or 'unavailable'. */
    static String availability(Context context) {
        int result = BiometricManager.from(context).canAuthenticate(authenticators());
        if (result == BiometricManager.BIOMETRIC_SUCCESS) return "ok";
        if (result == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED) return "none";
        return "unavailable";
    }

    private boolean enabled() {
        return AppSettings.get(activity).appLock && "ok".equals(availability(activity));
    }

    void onCreate() {
        activity.getOnBackPressedDispatcher().addCallback(activity, backWhileLocked);
        if (enabled()) lock();
    }

    void onStart() {
        if (!enabled()) {
            unlock();
            return;
        }
        long now = SystemClock.elapsedRealtime();
        long lockAfter = AppSettings.get(activity).lockAfterMinutes * 60_000L;
        if (!locked && hiddenAt > 0 && now - hiddenAt >= lockAfter) lock();
        hiddenAt = 0;
        if (locked && !prompting) prompt(null);
    }

    void onStop() {
        if (prompting) return;
        long now = SystemClock.elapsedRealtime();
        if (now >= externalUntil) hiddenAt = now;
    }

    /** The app is about to open a system screen of its own (picker, camera, share sheet, QR scanner). */
    void allowExternal() {
        externalUntil = SystemClock.elapsedRealtime() + 10 * 60_000L;
    }

    void endExternal() {
        externalUntil = SystemClock.elapsedRealtime() + 1500;
    }

    /** Settings changed: switching the lock off removes the cover; switching it on waits for the next start. */
    void settingsChanged() {
        if (!enabled()) unlock();
    }

    /** Ask once without locking (switching the lock on in Settings). */
    void verify(Result result) {
        prompt(result);
    }

    private void lock() {
        locked = true;
        backWhileLocked.setEnabled(true);
        if (cover == null) {
            cover = buildCover();
            activity.addContentView(cover, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }
        cover.setBackgroundColor(background);
        cover.setVisibility(View.VISIBLE);
        cover.bringToFront();
    }

    private void unlock() {
        locked = false;
        backWhileLocked.setEnabled(false);
        if (cover != null) cover.setVisibility(View.GONE);
    }

    private void prompt(Result result) {
        if (prompting) return;
        prompting = true;
        AppSettings s = AppSettings.get(activity);
        BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
            .setTitle(s.text("Odemknout OKfetch", "Unlock OKfetch"))
            .setSubtitle(s.text("Otisk prstu nebo zámek obrazovky", "Fingerprint or screen lock"))
            .setAllowedAuthenticators(authenticators())
            .setConfirmationRequired(false)
            .build();
        BiometricPrompt prompt = new BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), new BiometricPrompt.AuthenticationCallback() {
            @Override
            public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult authResult) {
                prompting = false;
                hiddenAt = 0;
                if (result != null) result.done(true);
                else unlock();
            }

            @Override
            public void onAuthenticationError(int code, @NonNull CharSequence message) {
                prompting = false;
                hiddenAt = 0;
                if (result != null) result.done(false);
            }
        });
        prompt.authenticate(info);
    }

    private View buildCover() {
        Context context = activity;
        AppSettings s = AppSettings.get(activity);
        FrameLayout frame = new FrameLayout(context);
        frame.setClickable(true);
        frame.setFocusable(true);
        LinearLayout column = new LinearLayout(context);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setGravity(Gravity.CENTER_HORIZONTAL);

        ImageView icon = new ImageView(context);
        icon.setImageResource(R.mipmap.ic_launcher_round);
        int size = dp(96);
        column.addView(icon, new LinearLayout.LayoutParams(size, size));

        TextView title = new TextView(context);
        title.setText("OKfetch");
        title.setTextColor(foreground);
        title.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 22);
        title.setPadding(0, dp(16), 0, dp(4));
        column.addView(title);

        TextView hint = new TextView(context);
        hint.setText(s.text("Aplikace je zamčená", "The app is locked"));
        hint.setTextColor(foreground);
        hint.setAlpha(0.7f);
        hint.setTypeface(Typeface.MONOSPACE);
        hint.setPadding(0, 0, 0, dp(24));
        column.addView(hint);

        Button unlock = new Button(context);
        unlock.setText(s.text("Odemknout", "Unlock"));
        unlock.setAllCaps(false);
        unlock.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        unlock.setOnClickListener((v) -> prompt(null));
        column.addView(unlock);

        frame.addView(column, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        return frame;
    }

    private int dp(int value) {
        return Math.round(value * activity.getResources().getDisplayMetrics().density);
    }
}
