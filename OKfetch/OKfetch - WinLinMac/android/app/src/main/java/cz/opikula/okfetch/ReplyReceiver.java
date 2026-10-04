package cz.opikula.okfetch;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import androidx.core.app.RemoteInput;
import org.json.JSONArray;

/** Reply and "mark read" straight from a message notification, without opening (or unlocking) the app. */
public class ReplyReceiver extends BroadcastReceiver {

    static final String ACTION_REPLY = "cz.opikula.okfetch.REPLY";
    static final String ACTION_READ = "cz.opikula.okfetch.READ";

    @Override
    public void onReceive(Context context, Intent intent) {
        String chatId = intent.getStringExtra(Notifier.EXTRA_CHAT);
        if (chatId == null) return;
        PendingResult result = goAsync();
        CoreHub hub = CoreHub.get(context);
        Notifier notifier = Notifier.get(context);
        if (ACTION_READ.equals(intent.getAction())) {
            notifier.cancelChat(chatId);
            hub.whenReady(() -> hub.call("markRead", new JSONArray().put(chatId), (ok, value, error) -> result.finish()));
            return;
        }
        Bundle input = RemoteInput.getResultsFromIntent(intent);
        CharSequence text = input == null ? null : input.getCharSequence(Notifier.KEY_REPLY);
        if (text == null || text.toString().trim().isEmpty()) {
            result.finish();
            return;
        }
        String html = "<p>" + escape(text.toString().trim()).replace("\n", "<br>") + "</p>";
        hub.whenReady(() -> hub.call("sendMessage", new JSONArray().put(chatId).put(html), (ok, value, error) -> {
            notifier.replied(chatId, ok);
            hub.call("markRead", new JSONArray().put(chatId), (ok2, value2, error2) -> result.finish());
        }));
    }

    private static String escape(String text) {
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }
}
