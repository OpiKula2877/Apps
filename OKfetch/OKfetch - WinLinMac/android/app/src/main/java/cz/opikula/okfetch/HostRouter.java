package cz.opikula.okfetch;

import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Log;
import android.webkit.MimeTypeMap;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;
import org.json.JSONArray;

/**
 * Answers what the core asks of Android ('host' messages): pickers, opening, sharing and saving files, links,
 * the clipboard. Paths the core sends are checked to lie inside the app's own folders.
 */
final class HostRouter implements CoreHub.HostHandler {

    private static final String TAG = "OKfetch";
    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());

    HostRouter(Context context) {
        this.context = context.getApplicationContext();
    }

    @Override
    public void handle(String method, JSONArray args, CoreHub.HostReply reply) {
        String first = args.optString(0, null);
        main.post(() -> {
            MainActivity activity = MainActivity.current();
            switch (method) {
                case "pickFile":
                    if (activity == null) reply.ok(null);
                    else if ("camera".equals(first)) activity.actions().takePhoto(reply::ok);
                    else activity.actions().pickFile(reply::ok);
                    break;
                case "pickDocument":
                    if (activity == null) reply.ok(null);
                    else activity.actions().pickDocument(reply::ok);
                    break;
                case "saveDocument": {
                    File source = insideApp(first);
                    if (activity == null || source == null) reply.ok(false);
                    else activity.actions().saveDocument(source, HostActions.safeName(args.optString(1, "OKfetch.okfb")), reply::ok);
                    break;
                }
                case "openFile":
                    view(insideApp(first), false);
                    reply.ok(null);
                    break;
                case "shareFile":
                    view(insideApp(first), true);
                    reply.ok(null);
                    break;
                case "saveFile": {
                    File file = insideApp(first);
                    if (file == null) reply.ok(false);
                    else HostActions.io.execute(() -> reply.ok(saveToDownloads(file)));
                    break;
                }
                case "openUrl":
                    openUrl(first);
                    reply.ok(null);
                    break;
                case "copyText":
                    ClipboardManager clipboard = (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
                    if (first != null) clipboard.setPrimaryClip(ClipData.newPlainText("OKfetch", first));
                    reply.ok(null);
                    break;
                default:
                    reply.ok(null);
            }
        });
    }

    /** The file, if it lies inside the app's storage or cache folder. */
    private File insideApp(String path) {
        if (path == null) return null;
        try {
            File file = new File(path).getCanonicalFile();
            String storage = AppSettings.storageRoot(context).getCanonicalPath() + File.separator;
            String cache = context.getCacheDir().getCanonicalPath() + File.separator;
            String full = file.getPath();
            return file.isFile() && (full.startsWith(storage) || full.startsWith(cache)) ? file : null;
        } catch (Exception error) {
            return null;
        }
    }

    static String mimeOf(String name) {
        int dot = name.lastIndexOf('.');
        String type = dot < 0 ? null : MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substring(dot + 1).toLowerCase(Locale.ROOT));
        return type == null ? "application/octet-stream" : type;
    }

    /** Received files are stored as <id>_<name>; show the name without the id. */
    static String shownName(File file) {
        String name = file.getName();
        return name.matches("^[0-9a-f]{32}_.+") ? name.substring(33) : name;
    }

    private void view(File file, boolean share) {
        if (file == null) return;
        MainActivity activity = MainActivity.current();
        Context starter = activity != null ? activity : context;
        try {
            Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file);
            String mime = mimeOf(file.getName());
            Intent intent;
            if (share) {
                intent = new Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri);
                intent.setClipData(ClipData.newRawUri(shownName(file), uri));
            } else {
                intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime);
            }
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(intent, null);
            if (activity == null) chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            else activity.lock().allowExternal();
            starter.startActivity(chooser);
        } catch (ActivityNotFoundException error) {
            toast(AppSettings.get(context).text("Žádná aplikace tento soubor neotevře", "No app can open this file"));
        } catch (Exception error) {
            Log.w(TAG, "cannot open the file", error);
        }
    }

    private boolean saveToDownloads(File file) {
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, shownName(file));
        values.put(MediaStore.Downloads.MIME_TYPE, mimeOf(file.getName()));
        values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/OKfetch");
        values.put(MediaStore.Downloads.IS_PENDING, 1);
        Uri uri = context.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (uri == null) return false;
        try (InputStream in = new FileInputStream(file); OutputStream out = context.getContentResolver().openOutputStream(uri, "w")) {
            if (out == null) throw new IllegalStateException("no output");
            HostActions.pipe(in, out);
        } catch (Exception error) {
            Log.w(TAG, "cannot save to Downloads", error);
            context.getContentResolver().delete(uri, null, null);
            return false;
        }
        values.clear();
        values.put(MediaStore.Downloads.IS_PENDING, 0);
        context.getContentResolver().update(uri, values, null, null);
        return true;
    }

    private void openUrl(String url) {
        if (url == null || !url.matches("(?i)^(https?://|mailto:).+")) return;
        MainActivity activity = MainActivity.current();
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            if (activity == null) {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(intent);
            } else {
                activity.lock().allowExternal();
                activity.startActivity(intent);
            }
        } catch (ActivityNotFoundException ignored) {
            // no browser
        }
    }

    private void toast(String text) {
        main.post(() -> Toast.makeText(context, text, Toast.LENGTH_SHORT).show());
    }
}
