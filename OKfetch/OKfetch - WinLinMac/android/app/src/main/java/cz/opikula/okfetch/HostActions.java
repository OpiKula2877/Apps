package cz.opikula.okfetch;

import android.Manifest;
import android.content.ContentResolver;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Log;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import com.journeyapps.barcodescanner.ScanContract;
import com.journeyapps.barcodescanner.ScanOptions;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.SecureRandom;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Screens that need the activity: file and document pickers, the camera, the save dialog and the QR scanner.
 * One request of each kind at a time; the answer goes back through a callback (null = cancelled).
 */
final class HostActions {

    interface PathResult {
        void done(String path);
    }

    interface BoolResult {
        void done(boolean ok);
    }

    private static final String TAG = "OKfetch";
    static final ExecutorService io = Executors.newSingleThreadExecutor();

    private final MainActivity activity;
    private final ActivityResultLauncher<String[]> openDocument;
    private final ActivityResultLauncher<Uri> takePicture;
    private final ActivityResultLauncher<String> createDocument;
    private final ActivityResultLauncher<String> cameraPermission;
    private final ActivityResultLauncher<ScanOptions> scanner;
    private PathResult pendingOpen;
    private boolean openCopiesToOutgoing;
    private File pendingPhoto;
    private PathResult pendingPhotoResult;
    private File pendingSaveSource;
    private BoolResult pendingSave;
    private PathResult pendingScan;

    HostActions(MainActivity activity) {
        this.activity = activity;
        openDocument = activity.registerForActivityResult(new ActivityResultContracts.OpenDocument(), this::onDocumentPicked);
        takePicture = activity.registerForActivityResult(new ActivityResultContracts.TakePicture(), this::onPhotoTaken);
        createDocument = activity.registerForActivityResult(new ActivityResultContracts.CreateDocument("application/octet-stream"), this::onSaveTarget);
        cameraPermission = activity.registerForActivityResult(new ActivityResultContracts.RequestPermission(), (granted) -> {
            if (granted) launchCamera();
            else finishPhoto(null);
        });
        scanner = activity.registerForActivityResult(new ScanContract(), (result) -> {
            activity.lock().endExternal();
            PathResult done = pendingScan;
            pendingScan = null;
            if (done != null) done.done(result.getContents());
        });
    }

    // --- files to send ------------------------------------------------------------------

    /** Let the user pick any file; it is copied to outgoing/<token>/<name> and that path is returned. */
    void pickFile(PathResult result) {
        if (pendingOpen != null) pendingOpen.done(null);
        pendingOpen = result;
        openCopiesToOutgoing = true;
        activity.lock().allowExternal();
        openDocument.launch(new String[] { "*/*" });
    }

    /** Pick a backup file for restoring; it is copied to the cache and that path is returned. */
    void pickDocument(PathResult result) {
        if (pendingOpen != null) pendingOpen.done(null);
        pendingOpen = result;
        openCopiesToOutgoing = false;
        activity.lock().allowExternal();
        openDocument.launch(new String[] { "*/*" });
    }

    private void onDocumentPicked(Uri uri) {
        activity.lock().endExternal();
        PathResult done = pendingOpen;
        pendingOpen = null;
        if (done == null) return;
        if (uri == null) {
            done.done(null);
            return;
        }
        boolean outgoing = openCopiesToOutgoing;
        io.execute(() -> {
            try {
                File target = outgoing
                    ? new File(newOutgoingDir(activity), safeName(displayName(activity.getContentResolver(), uri)))
                    : new File(activity.getCacheDir(), "restore-" + System.currentTimeMillis() + ".okfb");
                copy(activity.getContentResolver(), uri, target);
                done.done(target.getAbsolutePath());
            } catch (Exception error) {
                Log.w(TAG, "cannot copy the picked file", error);
                done.done(null);
            }
        });
    }

    /** Take a photo with the camera app into outgoing/<token>/IMG_….jpg. */
    void takePhoto(PathResult result) {
        if (pendingPhotoResult != null) pendingPhotoResult.done(null);
        pendingPhotoResult = result;
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) launchCamera();
        else {
            activity.lock().allowExternal();
            cameraPermission.launch(Manifest.permission.CAMERA);
        }
    }

    private void launchCamera() {
        try {
            String name = "IMG_" + new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.ROOT).format(new Date()) + ".jpg";
            pendingPhoto = new File(newOutgoingDir(activity), name);
            Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", pendingPhoto);
            activity.lock().allowExternal();
            takePicture.launch(uri);
        } catch (Exception error) {
            Log.w(TAG, "cannot open the camera", error);
            finishPhoto(null);
        }
    }

    private void onPhotoTaken(Boolean ok) {
        activity.lock().endExternal();
        File photo = pendingPhoto;
        boolean taken = Boolean.TRUE.equals(ok) && photo != null && photo.length() > 0;
        if (!taken && photo != null) deleteTree(photo.getParentFile());
        finishPhoto(taken ? photo.getAbsolutePath() : null);
    }

    private void finishPhoto(String path) {
        activity.lock().endExternal();
        PathResult done = pendingPhotoResult;
        pendingPhotoResult = null;
        pendingPhoto = null;
        if (done != null) done.done(path);
    }

    // --- saving a backup ------------------------------------------------------------------

    void saveDocument(File source, String name, BoolResult result) {
        if (pendingSave != null) pendingSave.done(false);
        pendingSave = result;
        pendingSaveSource = source;
        activity.lock().allowExternal();
        createDocument.launch(name);
    }

    private void onSaveTarget(Uri uri) {
        activity.lock().endExternal();
        BoolResult done = pendingSave;
        File source = pendingSaveSource;
        pendingSave = null;
        pendingSaveSource = null;
        if (done == null) return;
        if (uri == null || source == null) {
            done.done(false);
            return;
        }
        io.execute(() -> {
            try (InputStream in = new java.io.FileInputStream(source); OutputStream out = activity.getContentResolver().openOutputStream(uri, "w")) {
                if (out == null) throw new IllegalStateException("no output");
                pipe(in, out);
                done.done(true);
            } catch (Exception error) {
                Log.w(TAG, "cannot save the backup", error);
                done.done(false);
            }
        });
    }

    // --- QR ------------------------------------------------------------------------------

    void scanQr(PathResult result) {
        if (pendingScan != null) pendingScan.done(null);
        pendingScan = result;
        AppSettings s = AppSettings.get(activity);
        ScanOptions options = new ScanOptions()
            .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            .setPrompt(s.text("Namiřte na QR kód OKfetch", "Point at an OKfetch QR code"))
            .setBeepEnabled(false)
            .setOrientationLocked(false);
        activity.lock().allowExternal();
        scanner.launch(options);
    }

    // --- helpers --------------------------------------------------------------------------

    static File newOutgoingDir(Context context) {
        byte[] random = new byte[8];
        new SecureRandom().nextBytes(random);
        StringBuilder token = new StringBuilder();
        for (byte b : random) token.append(String.format(Locale.ROOT, "%02x", b));
        File dir = new File(new File(AppSettings.storageRoot(context), "outgoing"), token.toString());
        if (!dir.mkdirs() && !dir.isDirectory()) throw new IllegalStateException("cannot create " + dir);
        return dir;
    }

    static String displayName(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                String name = cursor.getString(0);
                if (name != null && !name.isEmpty()) return name;
            }
        } catch (Exception ignored) {
            // fall back to the last path segment
        }
        String last = uri.getLastPathSegment();
        return last == null ? "soubor" : last;
    }

    /** Like safeFileName() in the core (no separators or control characters, 120 characters), but keeps the end: the extension. */
    static String safeName(String name) {
        String cleaned = name.replaceAll("[<>:\"/\\\\|?*\\x00-\\x1f]", "_").replaceAll("^\\.+", "_").trim();
        if (cleaned.length() > 120) cleaned = cleaned.substring(cleaned.length() - 120);
        return cleaned.isEmpty() ? "soubor" : cleaned;
    }

    static void copy(ContentResolver resolver, Uri uri, File target) throws Exception {
        try (InputStream in = resolver.openInputStream(uri); OutputStream out = new FileOutputStream(target)) {
            if (in == null) throw new IllegalStateException("no input");
            pipe(in, out);
        }
    }

    static void pipe(InputStream in, OutputStream out) throws Exception {
        byte[] buffer = new byte[64 * 1024];
        int n;
        while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
    }

    static void deleteTree(File file) {
        if (file == null) return;
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteTree(child);
        file.delete();
    }
}
