package cz.opikula.okpass;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Fingerprint unlock. The secret is encrypted with an AES key that lives in Android Keystore and
 * can only be used right after a successful strong biometric check. Enrolling a new fingerprint
 * invalidates the key, so the secret becomes unreadable.
 */
@CapacitorPlugin(name = "OkpassBiometric")
public class OkpassBiometricPlugin extends Plugin {

    private static final String KEY_ALIAS = "okpass_biometric";
    private static final String PREFS = "okpass_biometric";
    private static final int AUTHENTICATORS = BiometricManager.Authenticators.BIOMETRIC_STRONG;

    private interface CipherAction {
        void run(Cipher cipher) throws Exception;
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private boolean available() {
        return BiometricManager.from(getContext()).canAuthenticate(AUTHENTICATORS) == BiometricManager.BIOMETRIC_SUCCESS;
    }

    @PluginMethod
    public void status(PluginCall call) {
        boolean available = available();
        JSObject out = new JSObject();
        out.put("available", available);
        out.put("enabled", available && prefs().contains("data"));
        call.resolve(out);
    }

    @PluginMethod
    public void store(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("No data", "ERROR");
            return;
        }
        try {
            clearAll();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, createKey());
            prompt(call, cipher, ready -> {
                byte[] encrypted = ready.doFinal(Base64.decode(data, Base64.NO_WRAP));
                prefs().edit()
                    .putString("iv", Base64.encodeToString(ready.getIV(), Base64.NO_WRAP))
                    .putString("data", Base64.encodeToString(encrypted, Base64.NO_WRAP))
                    .apply();
                call.resolve();
            });
        } catch (Exception error) {
            call.reject(String.valueOf(error.getMessage()), "ERROR", error);
        }
    }

    @PluginMethod
    public void unlock(PluginCall call) {
        String iv = prefs().getString("iv", null);
        String data = prefs().getString("data", null);
        if (iv == null || data == null) {
            call.reject("Fingerprint unlock is off", "NOT_ENABLED");
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, loadKey(), new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
            prompt(call, cipher, ready -> {
                byte[] plain = ready.doFinal(Base64.decode(data, Base64.NO_WRAP));
                JSObject out = new JSObject();
                out.put("data", Base64.encodeToString(plain, Base64.NO_WRAP));
                call.resolve(out);
            });
        } catch (KeyPermanentlyInvalidatedException error) {
            clearAll();
            call.reject("Fingerprints changed", "INVALIDATED");
        } catch (Exception error) {
            call.reject(String.valueOf(error.getMessage()), "ERROR", error);
        }
    }

    @PluginMethod
    public void clear(PluginCall call) {
        clearAll();
        call.resolve();
    }

    private void prompt(PluginCall call, Cipher cipher, CipherAction action) {
        getActivity().runOnUiThread(() -> {
            BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                .setTitle(call.getString("title", "OKpass"))
                .setSubtitle(call.getString("subtitle", ""))
                .setNegativeButtonText(call.getString("cancel", "Cancel"))
                .setAllowedAuthenticators(AUTHENTICATORS)
                .setConfirmationRequired(false)
                .build();
            BiometricPrompt prompt = new BiometricPrompt(
                (FragmentActivity) getActivity(),
                ContextCompat.getMainExecutor(getContext()),
                new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                        try {
                            BiometricPrompt.CryptoObject crypto = result.getCryptoObject();
                            if (crypto == null || crypto.getCipher() == null) throw new IllegalStateException("No cipher");
                            action.run(crypto.getCipher());
                        } catch (Exception error) {
                            call.reject(String.valueOf(error.getMessage()), "ERROR", error);
                        }
                    }

                    @Override
                    public void onAuthenticationError(int code, @NonNull CharSequence message) {
                        call.reject(message.toString(), "CANCELED");
                    }
                }
            );
            prompt.authenticate(info, new BiometricPrompt.CryptoObject(cipher));
        });
    }

    private SecretKey createKey() throws Exception {
        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(spec.build());
        return generator.generateKey();
    }

    private SecretKey loadKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        SecretKey key = (SecretKey) store.getKey(KEY_ALIAS, null);
        if (key == null) throw new KeyPermanentlyInvalidatedException("Key missing");
        return key;
    }

    private void clearAll() {
        try {
            KeyStore store = KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
            store.deleteEntry(KEY_ALIAS);
        } catch (Exception ignored) {
            // nothing stored
        }
        prefs().edit().clear().apply();
    }
}
