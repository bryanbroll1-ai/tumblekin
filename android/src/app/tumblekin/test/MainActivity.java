package app.tumblekin.test;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.view.View;
import android.view.ViewTreeObserver;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Die ganze App: eine WebView mit der Browser-Fassung von Tumblekin.
 *
 * Die Seite kommt aus den Assets (assets/www), ausgeliefert unter
 * https://appassets.androidplatform.net/ — diese Adresse hat Android für
 * genau diesen Zweck reserviert, sie geht nie ins Netz. Über file:// liefe
 * das Modul-Skript nicht, und localStorage bekäme keinen festen Ursprung.
 *
 * Spielserver und Bots laufen wie in der Browser-Fassung im Fenster selbst.
 */
public class MainActivity extends Activity {
    static final String HOST = "appassets.androidplatform.net";
    static final String START_URL = "https://" + HOST + "/index.html";
    private static final String TAG = "Tumblekin";
    private static final long BACK_WINDOW_MS = 2000;

    private WebView web;
    private FrameLayout root;
    private long backPressedAt;
    private int lastUsableHeight = -1;
    private boolean keyboardOpen;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Testfassung: chrome://inspect am Rechner darf die Seite untersuchen.
        WebView.setWebContentsDebuggingEnabled(true);

        web = new WebView(this);
        web.setBackgroundColor(0xff8fd6f2);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        // Die Oberfläche hat feste Grössen; eine grosse Systemschrift soll sie
        // nicht sprengen.
        settings.setTextZoom(100);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        // Kennzeichen für die Seite (browser/boot.js): hier gibt es keine
        // claude.ai-Raumfunktion, also andere Hinweise.
        settings.setUserAgentString(settings.getUserAgentString() + " TumblekinApp/" + versionName());

        web.setWebViewClient(new AssetClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                Log.d(TAG, message.message() + " (" + message.sourceId() + ":" + message.lineNumber() + ")");
                return true;
            }
        });

        root = new FrameLayout(this);
        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        root.getViewTreeObserver().addOnGlobalLayoutListener(new ViewTreeObserver.OnGlobalLayoutListener() {
            @Override
            public void onGlobalLayout() {
                fitAboveKeyboard();
            }
        });

        web.loadUrl(START_URL);
    }

    private String versionName() {
        try {
            String name = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            return name == null ? "0" : name;
        } catch (PackageManager.NameNotFoundException e) {
            return "0";
        }
    }

    // Vollbild ohne Status- und Navigationsleiste. "Sticky": ein Wisch vom Rand
    // zeigt sie kurz, ohne dass das Spiel den Wisch verliert.
    private void hideSystemBars() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    // Im Vollbild verkleinert Android das Fenster für die Tastatur nicht
    // zuverlässig. Darum wird die WebView selbst auf den sichtbaren Teil
    // gekürzt, solange die Tastatur offen ist — sonst verdeckt sie das
    // Namensfeld.
    private void fitAboveKeyboard() {
        if (web == null) return;
        Rect visible = new Rect();
        root.getWindowVisibleDisplayFrame(visible);
        int[] at = new int[2];
        root.getLocationOnScreen(at);
        int usable = visible.bottom - at[1];
        if (usable == lastUsableHeight) return;
        lastUsableHeight = usable;
        int full = root.getRootView().getHeight();
        boolean open = full - usable > full / 4;
        FrameLayout.LayoutParams params = (FrameLayout.LayoutParams) web.getLayoutParams();
        params.height = open ? usable : FrameLayout.LayoutParams.MATCH_PARENT;
        web.setLayoutParams(params);
        if (keyboardOpen && !open) hideSystemBars();
        keyboardOpen = open;
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        web.resumeTimers();
        hideSystemBars();
    }

    @Override
    protected void onPause() {
        web.onPause();
        web.pauseTimers();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            root.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    // Ein versehentliches Zurück soll keine Partie beenden: erst das zweite
    // innerhalb von zwei Sekunden schliesst die App.
    @Override
    public void onBackPressed() {
        long now = SystemClock.elapsedRealtime();
        if (now - backPressedAt < BACK_WINDOW_MS) {
            super.onBackPressed();
            return;
        }
        backPressedAt = now;
        Toast.makeText(this, R.string.back_again, Toast.LENGTH_SHORT).show();
    }

    // ------------------------------------------------------------------
    // Auslieferung der Assets

    /** Asset-Name zu einem Pfad unter HOST, oder null, wenn er nicht erlaubt ist. */
    static String assetFor(String path) {
        if (path == null || path.isEmpty() || path.equals("/")) return "www/index.html";
        if (path.contains("..") || path.contains("\\") || path.contains("//")) return null;
        return "www" + (path.startsWith("/") ? path : "/" + path);
    }

    static String mimeFor(String name) {
        String ext = name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        switch (ext) {
            case "html": return "text/html";
            case "js":
            case "mjs": return "text/javascript";
            case "css": return "text/css";
            case "json": return "application/json";
            case "svg": return "image/svg+xml";
            case "png": return "image/png";
            case "jpg":
            case "jpeg": return "image/jpeg";
            case "webp": return "image/webp";
            case "gif": return "image/gif";
            case "ico": return "image/x-icon";
            case "woff2": return "font/woff2";
            case "wasm": return "application/wasm";
            case "mp3": return "audio/mpeg";
            case "ogg": return "audio/ogg";
            case "wav": return "audio/wav";
            case "txt": return "text/plain";
            default: return "application/octet-stream";
        }
    }

    static boolean isText(String mime) {
        return mime.startsWith("text/") || mime.equals("application/json") || mime.equals("image/svg+xml");
    }

    private WebResourceResponse serve(Uri url) {
        String name = assetFor(url.getPath());
        Map<String, String> headers = new HashMap<String, String>();
        headers.put("Cache-Control", "no-cache");
        if (name != null) {
            try {
                InputStream in = getAssets().open(name);
                String mime = mimeFor(name);
                return new WebResourceResponse(mime, isText(mime) ? "utf-8" : null, 200, "OK", headers, in);
            } catch (IOException e) {
                // fällt durch auf 404
            }
        }
        Log.w(TAG, "nicht gefunden: " + url);
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers,
                new ByteArrayInputStream(new byte[0]));
    }

    static boolean isOwn(Uri url) {
        return url != null && "https".equals(url.getScheme()) && HOST.equals(url.getHost());
    }

    private class AssetClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            return isOwn(url) ? serve(url) : null;
        }

        // Ab API 24 (minSdk). Ohne @Override, weil gegen API 23 gebaut wird.
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return leave(request.getUrl());
        }

        @Override
        @SuppressWarnings("deprecation")
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return leave(Uri.parse(url));
        }

        // Eigene Seiten bleiben in der App, alles andere öffnet der Browser.
        private boolean leave(Uri url) {
            if (isOwn(url)) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, url));
            } catch (ActivityNotFoundException e) {
                Log.w(TAG, "keine App für " + url);
            }
            return true;
        }
    }
}
