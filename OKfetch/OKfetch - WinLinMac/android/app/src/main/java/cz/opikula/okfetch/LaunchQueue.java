package cz.opikula.okfetch;

import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.util.Log;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Things the app was opened for: a chat from a notification, files or text shared from another app, an okfetch:
 * link (QR code read by another app). They wait here until the UI takes them (it may still be loading).
 */
final class LaunchQueue {

    interface Listener {
        void changed();
    }

    private static final String TAG = "OKfetch";
    private static final List<JSONObject> items = new ArrayList<>();
    private static Listener listener;

    private LaunchQueue() {}

    static synchronized void setListener(Listener value) {
        listener = value;
    }

    static synchronized JSONArray take() {
        JSONArray out = new JSONArray();
        for (JSONObject item : items) out.put(item);
        items.clear();
        return out;
    }

    private static void add(JSONObject item) {
        Listener notify;
        synchronized (LaunchQueue.class) {
            items.add(item);
            notify = listener;
        }
        if (notify != null) notify.changed();
    }

    /** Read an intent that opened (or reached) the activity. Shared files are copied on a background thread. */
    static void handle(Context context, Intent intent) {
        if (intent == null) return;
        try {
            String chat = intent.getStringExtra(Notifier.EXTRA_CHAT);
            if (chat != null) {
                intent.removeExtra(Notifier.EXTRA_CHAT);
                add(new JSONObject().put("type", "open-chat").put("chatId", chat));
                return;
            }
            String action = intent.getAction();
            if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null && "okfetch".equals(intent.getData().getScheme())) {
                add(new JSONObject().put("type", "add-contact").put("text", intent.getData().toString()));
                intent.setData(null);
                return;
            }
            if (Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) {
                List<Uri> uris = sharedUris(intent);
                String text = intent.getStringExtra(Intent.EXTRA_TEXT);
                intent.setAction(null);
                HostActions.io.execute(() -> prepareShare(context.getApplicationContext(), uris, text));
            }
        } catch (Exception error) {
            Log.w(TAG, "cannot read the launch intent", error);
        }
    }

    @SuppressWarnings("deprecation")
    private static List<Uri> sharedUris(Intent intent) {
        List<Uri> uris = new ArrayList<>();
        ClipData clip = intent.getClipData();
        if (clip != null) {
            for (int i = 0; i < clip.getItemCount(); i++) if (clip.getItemAt(i).getUri() != null) uris.add(clip.getItemAt(i).getUri());
        }
        if (uris.isEmpty()) {
            if (Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())) {
                ArrayList<Uri> list = Build.VERSION.SDK_INT >= 33
                    ? intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class)
                    : intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (list != null) uris.addAll(list);
            } else {
                Uri one = Build.VERSION.SDK_INT >= 33 ? intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class) : intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (one != null) uris.add(one);
            }
        }
        return uris;
    }

    /** Copy shared files into outgoing/<token>/ (the core sends them from there) and queue them for the UI. */
    private static void prepareShare(Context context, List<Uri> uris, String text) {
        try {
            JSONArray files = new JSONArray();
            for (Uri uri : uris) {
                try {
                    File target = new File(HostActions.newOutgoingDir(context), HostActions.safeName(HostActions.displayName(context.getContentResolver(), uri)));
                    HostActions.copy(context.getContentResolver(), uri, target);
                    files.put(new JSONObject().put("path", target.getAbsolutePath()).put("name", target.getName()).put("size", target.length()));
                } catch (Exception error) {
                    Log.w(TAG, "cannot copy a shared file", error);
                }
            }
            if (files.length() == 0 && (text == null || text.trim().isEmpty())) return;
            JSONObject item = new JSONObject().put("type", "share").put("files", files);
            if (text != null && !text.trim().isEmpty()) item.put("text", text);
            add(item);
        } catch (Exception error) {
            Log.w(TAG, "cannot prepare the share", error);
        }
    }
}
