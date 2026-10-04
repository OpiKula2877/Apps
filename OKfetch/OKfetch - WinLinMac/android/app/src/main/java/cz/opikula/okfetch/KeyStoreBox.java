package cz.opikula.okfetch;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Log;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.security.KeyStore;
import java.security.SecureRandom;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * The data key of the core: 32 random bytes, stored only wrapped by an AES key that lives in Android Keystore
 * and cannot leave it. The core protects the identity and the contact keys with the data key, the way the
 * desktop version uses DPAPI / Keychain / libsecret.
 */
final class KeyStoreBox {

    private static final String TAG = "OKfetch";
    private static final String ALIAS = "okfetch_data_key_wrap";
    private static final int IV_BYTES = 12;

    private KeyStoreBox() {}

    static synchronized byte[] dataKey(Context context) {
        File file = new File(AppSettings.configDir(context), "data_key.bin");
        if (file.exists()) {
            try {
                return unwrap(file);
            } catch (Exception error) {
                // The Keystore key is gone (data partly cleared, device restored): keep the old file aside and
                // start with a new data key; the core then reports that the stored keys cannot be opened.
                Log.w(TAG, "data key cannot be unwrapped", error);
                file.renameTo(new File(file.getPath() + ".broken-" + System.currentTimeMillis()));
            }
        }
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        try {
            wrap(file, key);
        } catch (Exception error) {
            throw new IllegalStateException("cannot store the data key", error);
        }
        return key;
    }

    private static SecretKey wrapKey(boolean create) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        SecretKey key = (SecretKey) store.getKey(ALIAS, null);
        if (key != null || !create) return key;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(
            new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        );
        return generator.generateKey();
    }

    private static byte[] unwrap(File file) throws Exception {
        SecretKey key = wrapKey(false);
        if (key == null) throw new IllegalStateException("Keystore key missing");
        byte[] data = new byte[(int) file.length()];
        try (FileInputStream in = new FileInputStream(file)) {
            int read = 0;
            while (read < data.length) {
                int n = in.read(data, read, data.length - read);
                if (n < 0) throw new IllegalStateException("short file");
                read += n;
            }
        }
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, data, 0, IV_BYTES));
        byte[] plain = cipher.doFinal(data, IV_BYTES, data.length - IV_BYTES);
        if (plain.length != 32) throw new IllegalStateException("bad data key");
        return plain;
    }

    private static void wrap(File file, byte[] dataKey) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, wrapKey(true));
        byte[] iv = cipher.getIV();
        byte[] sealed = cipher.doFinal(dataKey);
        File dir = file.getParentFile();
        if (dir != null) dir.mkdirs();
        File tmp = new File(file.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(iv);
            out.write(sealed);
            out.getFD().sync();
        }
        if (!tmp.renameTo(file)) throw new IllegalStateException("cannot save the data key");
    }
}
