package cz.opikula.okfetch;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.RemoteInput;
import androidx.core.content.ContextCompat;
import org.json.JSONObject;

/** Notifications: new messages (with reply and "mark read"), new requests and the background service. */
final class Notifier {

    static final int SERVICE_ID = 1;
    private static final int REQUEST_ID = 2;
    static final String CHANNEL_MESSAGES = "messages";
    static final String CHANNEL_REQUESTS = "requests";
    static final String CHANNEL_SERVICE = "service";
    static final String EXTRA_CHAT = "okfetch_chat";
    static final String KEY_REPLY = "okfetch_reply";

    private static Notifier instance;
    private final Context context;

    static synchronized Notifier get(Context context) {
        if (instance == null) instance = new Notifier(context.getApplicationContext());
        return instance;
    }

    private Notifier(Context context) {
        this.context = context;
    }

    private AppSettings settings() {
        return AppSettings.get(context);
    }

    void ensureChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        AppSettings s = settings();
        manager.createNotificationChannel(new NotificationChannel(CHANNEL_MESSAGES, s.text("Zprávy", "Messages"), NotificationManager.IMPORTANCE_HIGH));
        manager.createNotificationChannel(new NotificationChannel(CHANNEL_REQUESTS, s.text("Žádosti", "Requests"), NotificationManager.IMPORTANCE_DEFAULT));
        NotificationChannel service = new NotificationChannel(CHANNEL_SERVICE, s.text("Služba na pozadí", "Background service"), NotificationManager.IMPORTANCE_MIN);
        service.setShowBadge(false);
        manager.createNotificationChannel(service);
    }

    private boolean allowed() {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        return settings().notifications;
    }

    private PendingIntent openApp(String chatId, int requestCode) {
        Intent intent = new Intent(context, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (chatId != null) intent.putExtra(EXTRA_CHAT, chatId);
        return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    Notification serviceNotification() {
        ensureChannels();
        AppSettings s = settings();
        return new NotificationCompat.Builder(context, CHANNEL_SERVICE)
            .setSmallIcon(R.drawable.ic_stat_okfetch)
            .setContentTitle("OKfetch")
            .setContentText(s.text("Běží na pozadí a přijímá zprávy", "Running in the background, receiving messages"))
            .setContentIntent(openApp(null, 0))
            .setOngoing(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build();
    }

    /** Core event → notification, unless the app is on the screen. */
    void onEvent(JSONObject event) {
        if (MainActivity.visible || !allowed()) return;
        String type = event.optString("type");
        if ("incoming".equals(type)) message(event.optString("chatId"), event.optString("title"), event.optString("text"));
        else if ("request".equals(type)) request(event.optString("title"));
    }

    private void message(String chatId, String title, String text) {
        if (chatId.isEmpty()) return;
        ensureChannels();
        AppSettings s = settings();
        int id = notificationId(chatId);
        boolean hide = s.hideNotificationContent;
        String newMessage = s.text("Nová zpráva", "New message");
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_MESSAGES)
            .setSmallIcon(R.drawable.ic_stat_okfetch)
            .setContentTitle(hide ? "OKfetch" : title)
            .setContentText(hide || text.isEmpty() ? newMessage : text)
            .setContentIntent(openApp(chatId, id))
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(
                new NotificationCompat.Builder(context, CHANNEL_MESSAGES)
                    .setSmallIcon(R.drawable.ic_stat_okfetch)
                    .setContentTitle("OKfetch")
                    .setContentText(newMessage)
                    .build()
            );
        if (!hide && !text.isEmpty()) builder.setStyle(new NotificationCompat.BigTextStyle().bigText(text));

        RemoteInput input = new RemoteInput.Builder(KEY_REPLY).setLabel(s.text("Odpověď", "Reply")).build();
        Intent reply = new Intent(context, ReplyReceiver.class).setAction(ReplyReceiver.ACTION_REPLY).putExtra(EXTRA_CHAT, chatId);
        PendingIntent replyIntent = PendingIntent.getBroadcast(context, id, reply, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
        builder.addAction(
            new NotificationCompat.Action.Builder(R.drawable.ic_stat_okfetch, s.text("Odpovědět", "Reply"), replyIntent)
                .addRemoteInput(input)
                .setAllowGeneratedReplies(false)
                .build()
        );
        Intent read = new Intent(context, ReplyReceiver.class).setAction(ReplyReceiver.ACTION_READ).putExtra(EXTRA_CHAT, chatId);
        PendingIntent readIntent = PendingIntent.getBroadcast(context, id + 1, read, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        builder.addAction(R.drawable.ic_stat_okfetch, s.text("Přečteno", "Mark read"), readIntent);
        notify(id, builder.build());
    }

    private void request(String name) {
        ensureChannels();
        AppSettings s = settings();
        Notification notification = new NotificationCompat.Builder(context, CHANNEL_REQUESTS)
            .setSmallIcon(R.drawable.ic_stat_okfetch)
            .setContentTitle("OKfetch")
            .setContentText(s.text("Nová žádost: ", "New request: ") + (s.hideNotificationContent ? "…" : name))
            .setContentIntent(openApp(null, REQUEST_ID))
            .setAutoCancel(true)
            .build();
        notify(REQUEST_ID, notification);
    }

    /** Short confirmation after a reply from the notification, then it disappears. */
    void replied(String chatId, boolean ok) {
        AppSettings s = settings();
        Notification notification = new NotificationCompat.Builder(context, CHANNEL_MESSAGES)
            .setSmallIcon(R.drawable.ic_stat_okfetch)
            .setContentTitle("OKfetch")
            .setContentText(ok ? s.text("Odesláno", "Sent") : s.text("Odeslání se nepovedlo", "Could not send"))
            .setTimeoutAfter(ok ? 2000 : 10000)
            .setSilent(true)
            .build();
        notify(notificationId(chatId), notification);
    }

    void cancelChat(String chatId) {
        NotificationManagerCompat.from(context).cancel(notificationId(chatId));
    }

    /** The app is on the screen: the chats show their unread messages themselves. */
    void cancelMessages() {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        for (android.service.notification.StatusBarNotification shown : manager.getActiveNotifications()) {
            if (shown.getId() != SERVICE_ID) manager.cancel(shown.getId());
        }
    }

    private void notify(int id, Notification notification) {
        try {
            NotificationManagerCompat.from(context).notify(id, notification);
        } catch (SecurityException denied) {
            // notifications not allowed
        }
    }

    private static int notificationId(String chatId) {
        // Even numbers above 100 for chats; +1 is used by the "mark read" intent.
        return 100 + ((chatId.hashCode() & 0x3fffffff) << 1);
    }
}
