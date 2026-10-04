package cz.opikula.okfetch;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Serves received images to the chat at https://localhost/okfetch-file/f/<path inside files/> (the phone's
 * okfetch-file:// of the desktop). Only files below storage/files are served; Capacitor's general file access
 * (/_capacitor_file_/…) is turned off, so the page cannot read the keys or the chats from disk.
 */
final class OkfetchWebViewClient extends BridgeWebViewClient {

    static final String FILE_PREFIX = "/okfetch-file/f/";
    private final File filesRoot;

    OkfetchWebViewClient(Bridge bridge, File storageRoot) {
        super(bridge);
        this.filesRoot = new File(storageRoot, "files");
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        String path = url.getPath();
        if (path != null && "localhost".equals(url.getHost())) {
            if (path.startsWith(FILE_PREFIX)) return serve(path.substring(FILE_PREFIX.length()));
            if (path.startsWith(Bridge.CAPACITOR_FILE_START)) return notFound();
        }
        return super.shouldInterceptRequest(view, request);
    }

    private WebResourceResponse serve(String relative) {
        try {
            File base = filesRoot.getCanonicalFile();
            File file = new File(base, relative).getCanonicalFile();
            if (!file.getPath().startsWith(base.getPath() + File.separator) || !file.isFile()) return notFound();
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-cache");
            return new WebResourceResponse(HostRouter.mimeOf(file.getName()), null, 200, "OK", headers, new FileInputStream(file));
        } catch (Exception error) {
            return notFound();
        }
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }
}
