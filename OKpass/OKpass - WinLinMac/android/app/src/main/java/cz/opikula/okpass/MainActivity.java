package cz.opikula.okpass;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OkpassAuthPlugin.class);
        registerPlugin(OkpassBiometricPlugin.class);
        registerPlugin(OkpassWindowPlugin.class);
        super.onCreate(savedInstanceState);

        // No screenshots and no content preview in the recent-apps screen.
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);

        // Draw behind the system bars on every Android version and keep the page clear of them
        // with padding; the padding shows the theme background. The keyboard is not added here:
        // the window already makes room for it (adding it again left an empty gap).
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        View content = findViewById(android.R.id.content);
        content.setBackgroundColor(Color.parseColor("#0E0A0A"));
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, insets) -> {
            Insets bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
    }
}
