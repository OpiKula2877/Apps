package cz.opikula.okfetch;

import android.content.Context;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Base64;
import android.util.Log;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import org.json.JSONArray;
import org.json.JSONObject;
import to.holepunch.bare.kit.IPC;
import to.holepunch.bare.kit.Worklet;

/**
 * Owns the Bare worklet that runs the OKfetch core and routes the newline-delimited JSON between it, the WebView
 * and Java. Ids tell who asked: 'w…' the WebView, 'j…' Java, 'h…' the worklet asking Java (see src/mobile/rpc.ts).
 * All IPC work happens on one thread with its own Looper, which is where Bare Kit calls back.
 */
final class CoreHub {

    interface LineListener {
        void onLine(String line);
    }

    interface EventListener {
        void onEvent(JSONObject event);
    }

    interface CallCallback {
        void done(boolean ok, Object result, String error);
    }

    interface HostReply {
        void ok(Object result);
    }

    interface HostHandler {
        void handle(String method, JSONArray args, HostReply reply);
    }

    private static final String TAG = "OKfetch";
    private static final long SHUTDOWN_TIMEOUT_MS = 5000;
    private static final long STOP_AFTER_HIDDEN_MS = 60_000;
    private static CoreHub instance;

    private final Context context;
    private final Handler handler;
    private Worklet worklet;
    private IPC ipc;
    private boolean running;
    private final ArrayDeque<ByteBuffer> writes = new ArrayDeque<>();
    private final ByteArrayOutputStream partial = new ByteArrayOutputStream();
    private final Map<String, CallCallback> calls = new HashMap<>();
    private final List<Runnable> whenReady = new ArrayList<>();
    private final List<EventListener> eventListeners = new CopyOnWriteArrayList<>();
    private final List<Long> crashes = new ArrayList<>();
    private volatile LineListener webListener;
    private volatile HostHandler hostHandler;
    private volatile String phase = "stopped";
    private int nextCall;
    private boolean stopping;
    private final Runnable stopWhenHidden = () -> {
        if (!AppSettings.get(contextRef()).backgroundService) stop(() -> CoreService.stop(contextRef()));
    };

    static synchronized CoreHub get(Context context) {
        if (instance == null) instance = new CoreHub(context.getApplicationContext());
        return instance;
    }

    private CoreHub(Context context) {
        this.context = context;
        HandlerThread thread = new HandlerThread("okfetch-core");
        thread.start();
        handler = new Handler(thread.getLooper());
        eventListeners.add(Notifier.get(context)::onEvent);
    }

    private Context contextRef() {
        return context;
    }

    // --- listeners ------------------------------------------------------------------

    void setWebListener(LineListener listener) {
        webListener = listener;
    }

    void setHostHandler(HostHandler handler) {
        hostHandler = handler;
    }

    void addEventListener(EventListener listener) {
        eventListeners.add(listener);
    }

    void removeEventListener(EventListener listener) {
        eventListeners.remove(listener);
    }

    String phase() {
        return phase;
    }

    // --- life cycle -------------------------------------------------------------------

    void start() {
        handler.post(this::startOnThread);
    }

    /** The app came back to the screen (cancel a pending stop) or left it (stop later, unless it runs in the background). */
    void appVisible(boolean visible) {
        handler.removeCallbacks(stopWhenHidden);
        if (visible) start();
        else handler.postDelayed(stopWhenHidden, STOP_AFTER_HIDDEN_MS);
    }

    /** Run once the core is ready (or right away when it already is). */
    void whenReady(Runnable task) {
        handler.post(() -> {
            if ("ready".equals(phase)) task.run();
            else {
                whenReady.add(task);
                startOnThread();
            }
        });
    }

    void stop(Runnable done) {
        handler.post(() -> {
            if (!running) {
                if (done != null) done.run();
                return;
            }
            stopping = true;
            Runnable finish = () -> {
                if (running) terminate();
                stopping = false;
                if (done != null) done.run();
            };
            handler.postDelayed(finish, SHUTDOWN_TIMEOUT_MS);
            callOnThread("shutdown", new JSONArray(), (ok, result, error) -> {
                handler.removeCallbacks(finish);
                finish.run();
            });
        });
    }

    private void startOnThread() {
        if (running) return;
        try {
            byte[] dataKey = KeyStoreBox.dataKey(context);
            ByteBuffer source = readAsset("okfetch.bundle");
            worklet = new Worklet(new Worklet.Options());
            worklet.start("/okfetch.bundle", source, null);
            ipc = new IPC(worklet);
            ipc.readable(this::onReadable);
            running = true;
            phase = "starting";
            JSONObject options = new JSONObject();
            options.put("root", AppSettings.storageRoot(context).getAbsolutePath());
            options.put("configDir", AppSettings.configDir(context).getAbsolutePath());
            options.put("cacheDir", context.getCacheDir().getAbsolutePath());
            options.put("dataKey", new JSONObject().put("$bytes", Base64.encodeToString(dataKey, Base64.NO_WRAP)));
            JSONArray args = new JSONArray().put(options);
            callOnThread("init", args, (ok, result, error) -> {
                if (!ok) Log.e(TAG, "core init failed: " + error);
            });
        } catch (Exception error) {
            Log.e(TAG, "cannot start the core", error);
            phase = "failed";
        }
    }

    private ByteBuffer readAsset(String name) throws Exception {
        try (InputStream in = context.getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] chunk = new byte[64 * 1024];
            int n;
            while ((n = in.read(chunk)) > 0) out.write(chunk, 0, n);
            byte[] data = out.toByteArray();
            ByteBuffer buffer = ByteBuffer.allocateDirect(data.length);
            buffer.put(data);
            buffer.flip();
            return buffer;
        }
    }

    private void terminate() {
        running = false;
        phase = "stopped";
        writes.clear();
        partial.reset();
        try {
            ipc.readable(null);
            ipc.writable(null);
            ipc.close();
        } catch (Exception ignored) {
            // already closed
        }
        try {
            worklet.terminate();
        } catch (Exception ignored) {
            // already gone
        }
        ipc = null;
        worklet = null;
        for (CallCallback callback : calls.values()) callback.done(false, null, "stopped");
        calls.clear();
    }

    /** The worklet closed its end: it crashed. Start it again, at most three times a minute. */
    private void onWorkletGone() {
        if (!running) return;
        boolean expected = stopping;
        terminate();
        if (expected) return;
        long now = System.currentTimeMillis();
        crashes.removeIf((time) -> now - time > 60_000);
        crashes.add(now);
        if (crashes.size() <= 3) handler.postDelayed(this::startOnThread, 1000);
        else Log.e(TAG, "the core keeps crashing; not restarting");
    }

    // --- reading ------------------------------------------------------------------------

    private void onReadable() {
        if (ipc == null) return;
        ByteBuffer data;
        while (ipc != null && (data = ipc.read()) != null) {
            if (data.limit() == 0) {
                // Not inside the IPC's own callback: close it from the next turn of the loop.
                ipc.readable(null);
                handler.post(this::onWorkletGone);
                return;
            }
            byte[] bytes = new byte[data.remaining()];
            data.get(bytes);
            int start = 0;
            for (int i = 0; i < bytes.length; i++) {
                if (bytes[i] != '\n') continue;
                partial.write(bytes, start, i - start);
                String line = new String(partial.toByteArray(), StandardCharsets.UTF_8);
                partial.reset();
                start = i + 1;
                if (!line.isEmpty()) route(line);
            }
            partial.write(bytes, start, bytes.length - start);
        }
    }

    private void route(String line) {
        JSONObject message;
        try {
            message = new JSONObject(line);
        } catch (Exception error) {
            Log.w(TAG, "bad line from the core");
            return;
        }
        String type = message.optString("t");
        String id = message.optString("id");
        switch (type) {
            case "reply":
                if (id.startsWith("w")) {
                    LineListener web = webListener;
                    if (web != null) web.onLine(line);
                } else {
                    CallCallback callback = calls.remove(id);
                    if (callback != null) {
                        boolean ok = message.optBoolean("ok");
                        callback.done(ok, message.opt("result"), message.optString("error", null));
                    }
                }
                break;
            case "event":
                LineListener web = webListener;
                if (web != null) web.onLine(line);
                JSONObject event = message.optJSONObject("event");
                if (event != null) onEvent(event);
                break;
            case "host":
                handleHost(id, message.optString("method"), message.optJSONArray("args"));
                break;
            default:
                break;
        }
    }

    private void onEvent(JSONObject event) {
        String type = event.optString("type");
        if ("app".equals(type)) {
            JSONObject status = event.optJSONObject("status");
            phase = status == null ? "starting" : status.optString("phase", "starting");
            Log.i(TAG, "core: " + phase);
            if ("ready".equals(phase) && !whenReady.isEmpty()) {
                List<Runnable> tasks = new ArrayList<>(whenReady);
                whenReady.clear();
                for (Runnable task : tasks) task.run();
            }
        } else if ("settings".equals(type)) {
            JSONObject settings = event.optJSONObject("settings");
            if (settings != null) AppSettings.update(settings);
        }
        for (EventListener listener : eventListeners) {
            try {
                listener.onEvent(event);
            } catch (Exception error) {
                Log.w(TAG, "event listener failed", error);
            }
        }
    }

    private void handleHost(String id, String method, JSONArray args) {
        HostReply reply = (result) -> handler.post(() -> {
            try {
                JSONObject answer = new JSONObject()
                    .put("t", "reply")
                    .put("id", id)
                    .put("ok", true)
                    .put("result", result == null ? JSONObject.NULL : result);
                writeOnThread(answer.toString());
            } catch (Exception error) {
                Log.w(TAG, "cannot answer the core", error);
            }
        });
        HostHandler host = hostHandler;
        if (host == null) {
            reply.ok(null);
            return;
        }
        try {
            host.handle(method, args == null ? new JSONArray() : args, reply);
        } catch (Exception error) {
            Log.w(TAG, "host call failed: " + method, error);
            reply.ok(null);
        }
    }

    // --- writing ------------------------------------------------------------------------

    /** A line from the WebView (its own 'w…' ids). Starts the core if it is not running. */
    void sendFromWeb(String line) {
        handler.post(() -> {
            startOnThread();
            writeOnThread(line);
        });
    }

    /** A call made by Java (notification reply, mark read). */
    void call(String method, JSONArray args, CallCallback callback) {
        handler.post(() -> {
            startOnThread();
            callOnThread(method, args, callback);
        });
    }

    private void callOnThread(String method, JSONArray args, CallCallback callback) {
        String id = "j" + (nextCall++);
        if (callback != null) calls.put(id, callback);
        try {
            writeOnThread(new JSONObject().put("t", "call").put("id", id).put("method", method).put("args", args).toString());
        } catch (Exception error) {
            calls.remove(id);
            if (callback != null) callback.done(false, null, String.valueOf(error.getMessage()));
        }
    }

    private void writeOnThread(String line) {
        if (!running || ipc == null) return;
        byte[] bytes = (line + "\n").getBytes(StandardCharsets.UTF_8);
        ByteBuffer buffer = ByteBuffer.allocateDirect(bytes.length);
        buffer.put(bytes);
        buffer.flip();
        writes.add(buffer);
        if (writes.size() == 1) flush();
    }

    private void flush() {
        while (ipc != null && !writes.isEmpty()) {
            ByteBuffer head = writes.peek();
            int written = ipc.write(head);
            if (written < 0) written = 0;
            if (written >= head.limit()) {
                writes.poll();
                continue;
            }
            // The IPC writes from the start of the buffer: keep the rest as a new buffer and wait.
            head.position(written);
            ByteBuffer rest = ByteBuffer.allocateDirect(head.remaining());
            rest.put(head);
            rest.flip();
            writes.poll();
            writes.addFirst(rest);
            ipc.writable(() -> {
                if (ipc != null) ipc.writable(null);
                flush();
            });
            return;
        }
    }
}
