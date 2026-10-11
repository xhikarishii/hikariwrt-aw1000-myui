package moe.hikarishii.hikariwrt;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.content.res.TypedArray;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.Typeface;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.net.RouteInfo;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.provider.MediaStore;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.inputmethod.EditorInfo;
import android.webkit.JavascriptInterface;
import android.webkit.SslErrorHandler;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.Inet4Address;
import java.security.cert.X509Certificate;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * HikariWrt for Android: the router's web UI in a full-screen WebView.
 *
 * Two screens in one activity, swapped inside `content`:
 *   setup   first launch (or "Change router address"): the user types the
 *           router's address; this network's gateway is offered as a
 *           suggestion only. Connect checks it really is a HikariWrt router
 *           before it is saved. It is also where a lost connection lands:
 *           the saved address filled in, what went wrong, and a retry every
 *           few seconds that carries on by itself once the router answers.
 *   web     the WebView on http(s)://<router>/webui/. While it is showing, a
 *           watchdog checks the router still answers (and at once when the
 *           phone's network changes or the app comes back to the front).
 *
 * What a plain WebView doesn't do by itself, and the web UI relies on, is
 * handled here: the file pickers (backup restore, firmware, WireGuard import),
 * links that belong outside the app, a router that moved to a new LAN address,
 * a self-signed HTTPS certificate, and - through window.HikariApp - tinting
 * the system bars to the UI's colours, the clipboard, the backup download
 * (a form POST, which a WebView DownloadListener can't repeat), and "Remember
 * me": the sign-in, sealed by the Keystore (Vault), for the login page to use
 * when the app is opened again.
 */
public class MainActivity extends Activity {
    static final String ACTION_SETUP = "moe.hikarishii.hikariwrt.SETUP";
    private static final int REQ_FILE = 1;
    private static final String PREF_ADDRESS = "address";
    private static final String PREF_LOGIN = "login";
    /** The watchdog's pace while the router answers. */
    private static final long PROBE_MS = 15000;
    /** Missed answers before the connection counts as lost: about 15 s, or 8 min while the UI waits for a restart. */
    private static final int LOST_AFTER = 3, LOST_AFTER_WAITING = 32;

    private SharedPreferences prefs;
    private Pins pins;
    private final Handler ui = new Handler(Looper.getMainLooper());

    private FrameLayout root;     // painted behind the transparent status bar
    private View navStrip;        // behind the navigation bar, sized to it
    private FrameLayout content;  // padded clear of the bars and the keyboard
    private WebView web;
    private View setupView;

    private volatile RouterAddress router;
    /** Origin of the page now in the WebView, checked by every bridge call. */
    private volatile String pageUrl = "";
    private ValueCallback<Uri[]> fileCallback;
    private boolean webLoaded;

    private boolean resumed, probing;
    private int probeFails;
    /** Set by the web UI while it waits for a restart or firmware upgrade it started. */
    private volatile boolean waiting;
    /** Bumped whenever the screen changes: ends the setup screen's retry loop. */
    private int screen;
    private ConnectivityManager.NetworkCallback netCallback;

    // ------------------------------------------------------------ lifecycle --

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        prefs = getSharedPreferences("app", MODE_PRIVATE);
        pins = new Pins(this);
        router = RouterAddress.parse(prefs.getString(PREF_ADDRESS, null));

        edgeToEdge();
        root = new FrameLayout(this);
        root.setBackgroundColor(themeColor(android.R.attr.colorBackground, Color.BLACK));
        content = new FrameLayout(this);
        navStrip = new View(this);
        root.addView(navStrip, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, Gravity.BOTTOM));
        root.addView(content, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.setOnApplyWindowInsetsListener(this::onInsets);
        setContentView(root);
        barsForNative();

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::back);
        }

        if (ACTION_SETUP.equals(getIntent().getAction()) || router == null) {
            showSetup();
        } else {
            showWeb(saved);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (ACTION_SETUP.equals(intent.getAction())) showSetup();
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        // Back from the background, maybe on another network: check at once.
        watch(300);
        netCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network n) {
                ui.post(() -> watch(1500));
            }

            @Override
            public void onLost(Network n) {
                ui.post(() -> watch(500));
            }
        };
        try {
            getSystemService(ConnectivityManager.class).registerDefaultNetworkCallback(netCallback);
        } catch (Exception e) {
            netCallback = null; // the periodic check still runs
        }
    }

    @Override
    protected void onPause() {
        resumed = false;
        ui.removeCallbacks(probe);
        if (netCallback != null) {
            try {
                getSystemService(ConnectivityManager.class).unregisterNetworkCallback(netCallback);
            } catch (Exception e) {
                // not registered
            }
            netCallback = null;
        }
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null && webLoaded) web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    /** Before Android 13 (API 33); from then on back() is registered with the dispatcher. */
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        back();
    }

    private void back() {
        if (setupView != null && setupView.getParent() != null && router != null && webLoaded) {
            showWebView();
        } else if (web != null && web.getParent() != null && web.canGoBack()) {
            web.goBack();
        } else {
            // What a launcher activity does by default on Android 12+: keep the
            // task (and the signed-in page) rather than finish it.
            moveTaskToBack(true);
        }
    }

    // ------------------------------------------------------ window and bars --

    @SuppressWarnings("deprecation")
    private void edgeToEdge() {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
        } else {
            w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(Color.TRANSPARENT);
        w.setStatusBarContrastEnforced(false);
        w.setNavigationBarContrastEnforced(false);
    }

    /** Keep the page clear of the status bar, navigation bar, cutout and keyboard. */
    @SuppressWarnings("deprecation")
    private WindowInsets onInsets(View v, WindowInsets insets) {
        Insets i;
        if (Build.VERSION.SDK_INT >= 30) {
            i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
        } else {
            i = insets.getSystemWindowInsets();
        }
        content.setPadding(i.left, i.top, i.right, i.bottom);
        ViewGroup.LayoutParams lp = navStrip.getLayoutParams();
        if (lp.height != i.bottom) {
            lp.height = i.bottom;
            navStrip.setLayoutParams(lp);
        }
        return Build.VERSION.SDK_INT >= 30 ? WindowInsets.CONSUMED : insets.consumeSystemWindowInsets();
    }

    /**
     * Tint what shows behind the transparent bars - `top` behind the status
     * bar, `bottom` behind the navigation bar - and pick light or dark bar
     * icons to stay readable on them. The bars themselves stay transparent:
     * Android 15+ ignores bar colours for apps drawing edge to edge.
     */
    @SuppressWarnings("deprecation")
    private void tintBars(int top, int bottom, boolean dark) {
        root.setBackgroundColor(top);
        navStrip.setBackgroundColor(bottom);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                int light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                c.setSystemBarsAppearance(dark ? 0 : light, light);
            }
        } else {
            View d = getWindow().getDecorView();
            int f = d.getSystemUiVisibility();
            int light = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            d.setSystemUiVisibility(dark ? (f & ~light) : (f | light));
        }
    }

    private boolean nightMode() {
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    /** The native screens follow the platform theme. */
    private void barsForNative() {
        int bg = themeColor(android.R.attr.colorBackground, nightMode() ? Color.BLACK : Color.WHITE);
        tintBars(bg, bg, nightMode());
    }

    private int themeColor(int attr, int fallback) {
        TypedArray a = obtainStyledAttributes(new int[] {attr});
        try {
            return a.getColor(0, fallback);
        } finally {
            a.recycle();
        }
    }

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private void show(View v) {
        screen++;
        content.removeAllViews();
        content.addView(v, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.requestApplyInsets();
    }

    // ---------------------------------------------------------------- setup --

    /** The phone's current default gateway (IPv4), offered on the setup screen. */
    private String gateway() {
        try {
            ConnectivityManager cm = getSystemService(ConnectivityManager.class);
            Network n = cm.getActiveNetwork();
            LinkProperties lp = n != null ? cm.getLinkProperties(n) : null;
            if (lp == null) return null;
            for (RouteInfo r : lp.getRoutes()) {
                if (r.isDefaultRoute() && r.getGateway() instanceof Inet4Address) {
                    String g = r.getGateway().getHostAddress();
                    if (g != null && !g.equals("0.0.0.0")) return g;
                }
            }
        } catch (Exception e) {
            // no suggestion, then
        }
        return null;
    }

    private void showSetup() {
        showSetup(null, false);
    }

    /**
     * The address form. With a `problem` it says what went wrong with the
     * saved address; with `retry` it also keeps trying that address every few
     * seconds and goes back to the UI once it answers - until the user edits
     * the address or leaves the screen.
     */
    private void showSetup(String problem, boolean retry) {
        barsForNative();
        int pad = dp(28);
        int muted = themeColor(android.R.attr.textColorSecondary, Color.GRAY);

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);
        col.setPadding(pad, pad, pad, pad);

        ImageView icon = new ImageView(this);
        icon.setImageDrawable(getDrawable(R.mipmap.ic_launcher));
        col.addView(icon, new LinearLayout.LayoutParams(dp(88), dp(88)));

        TextView title = new TextView(this);
        title.setText(R.string.app_name);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 28);
        title.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, dp(12), 0, dp(6));
        col.addView(title);

        TextView lead = new TextView(this);
        if (problem != null && router != null) {
            title.setText("Can’t reach the router");
            lead.setText("Lost the connection to " + router.display() + ". Check that this phone is on the router’s Wi-Fi or LAN. "
                    + "If the router has a new address, enter it below.");
        } else {
            lead.setText("Enter your router’s address to connect. It’s the address you open the router’s settings at, for example 192.168.1.1.");
        }
        lead.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        lead.setTextColor(muted);
        lead.setGravity(Gravity.CENTER);
        lead.setPadding(0, 0, 0, dp(20));
        col.addView(lead);

        TextView label = new TextView(this);
        label.setText("Router address");
        label.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        label.setTextColor(muted);
        col.addView(label, fullWidth());

        final String gw = gateway();
        final EditText field = new EditText(this);
        field.setSingleLine(true);
        field.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        field.setImeOptions(EditorInfo.IME_ACTION_GO);
        field.setHint(gw != null ? gw : "192.168.1.1");
        field.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        if (router != null) field.setText(router.display());
        field.setSelection(field.getText().length());
        col.addView(field, fullWidth());

        if (gw != null && (router == null || !gw.equals(router.host))) {
            Button use = new Button(this, null, android.R.attr.borderlessButtonStyle);
            use.setAllCaps(false);
            use.setText("Use " + gw + " (this network’s gateway)");
            use.setOnClickListener(v -> {
                field.setText(gw);
                field.setSelection(gw.length());
            });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.gravity = Gravity.START;
            col.addView(use, lp);
        }

        final TextView status = new TextView(this);
        status.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        status.setPadding(0, dp(8), 0, dp(8));
        if (problem != null) {
            status.setTextColor(Color.rgb(0xBA, 0x1A, 0x1A));
            status.setText(retry ? "No answer (" + problem + "). Trying again every few seconds…" : problem);
        }
        col.addView(status, fullWidth());

        final ProgressBar busy = new ProgressBar(this);
        busy.setIndeterminate(true);
        busy.setVisibility(View.GONE);
        col.addView(busy, new LinearLayout.LayoutParams(dp(36), dp(36)));

        final Button connect = new Button(this);
        connect.setAllCaps(false);
        connect.setText("Connect");
        connect.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        col.addView(connect, fullWidth());

        TextView foot = new TextView(this);
        foot.setText("Using HTTPS? Type https:// in front of the address and accept the router’s certificate once.");
        foot.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        foot.setTextColor(muted);
        foot.setGravity(Gravity.CENTER);
        foot.setPadding(0, dp(16), 0, 0);
        col.addView(foot, fullWidth());

        final Runnable go = () -> connect(field, status, busy, connect);
        connect.setOnClickListener(v -> go.run());
        field.setOnEditorActionListener((v, actionId, ev) -> {
            if (actionId == EditorInfo.IME_ACTION_GO || (ev != null && ev.getKeyCode() == KeyEvent.KEYCODE_ENTER)) {
                go.run();
                return true;
            }
            return false;
        });

        // Centred, and no wider than a phone column on tablets.
        FrameLayout center = new FrameLayout(this);
        FrameLayout.LayoutParams clp = new FrameLayout.LayoutParams(Math.min(dp(460), getResources().getDisplayMetrics().widthPixels),
                ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER);
        center.addView(col, clp);
        ScrollView sv = new ScrollView(this);
        sv.setFillViewport(true);
        sv.addView(center);
        setupView = sv;
        show(sv);
        if (problem == null) field.requestFocus();
        if (retry && router != null) retry(screen, router, field.getText().toString(), field, connect, go);
    }

    /** The lost-connection retry: Connect by itself once the router answers again. */
    private void retry(int on, RouterAddress a, String typed, EditText field, Button connect, Runnable go) {
        ui.postDelayed(() -> {
            if (on != screen || !typed.equals(field.getText().toString())) return;
            if (!connect.isEnabled()) {
                retry(on, a, typed, field, connect, go);
                return;
            }
            new Thread(() -> {
                final boolean up = Net.reach(a, pins) == null;
                ui.post(() -> {
                    if (on != screen || !typed.equals(field.getText().toString())) return;
                    if (up && connect.isEnabled()) go.run();
                    else retry(on, a, typed, field, connect, go);
                });
            }).start();
        }, 5000);
    }

    private LinearLayout.LayoutParams fullWidth() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private void connect(EditText field, TextView status, ProgressBar busy, Button connect) {
        final String typed = field.getText().toString().trim();
        final int err = Color.rgb(0xBA, 0x1A, 0x1A);
        // The hint (this network's gateway) is a suggestion, never used unasked.
        if (typed.isEmpty()) {
            status.setTextColor(err);
            status.setText("Type your router’s address first" + (gateway() != null ? ", or tap the suggestion above." : "."));
            return;
        }
        final RouterAddress a = RouterAddress.parse(typed);
        if (a == null) {
            status.setTextColor(err);
            status.setText("That isn’t an address. Type the router’s IP address, for example 192.168.1.1.");
            return;
        }
        status.setTextColor(themeColor(android.R.attr.textColorSecondary, Color.GRAY));
        status.setText("Connecting to " + a.display() + "…");
        busy.setVisibility(View.VISIBLE);
        connect.setEnabled(false);

        new Thread(() -> {
            final Net.Check r = Net.check(a, pins);
            ui.post(() -> {
                busy.setVisibility(View.GONE);
                connect.setEnabled(true);
                switch (r.kind) {
                    case OK:
                        prefs.edit().putString(PREF_ADDRESS, a.base()).apply();
                        boolean moved = router == null || !router.base().equals(a.base());
                        router = a;
                        if (moved || !webLoaded) showWeb(null);
                        else showWebView();
                        break;
                    case CERT_UNTRUSTED:
                        askTrust(a.host, r.cert, ok -> {
                            if (ok) connect(field, status, busy, connect);
                            else {
                                status.setTextColor(err);
                                status.setText("Not connected: the router’s certificate wasn’t accepted.");
                            }
                        });
                        break;
                    case OPENWRT_NO_UI:
                        status.setTextColor(err);
                        status.setText("That’s an OpenWrt router, but the HikariWrt web UI isn’t installed on it (nothing at /webui/).");
                        break;
                    case NOT_ROUTER:
                        status.setTextColor(err);
                        status.setText("Something answered at " + a.display() + ", but it isn’t a HikariWrt router.");
                        break;
                    default:
                        status.setTextColor(err);
                        status.setText("No answer from " + a.display() + ". Check that this phone is on the router’s Wi-Fi or LAN, and the address."
                                + (r.detail != null ? "\n(" + r.detail + ")" : ""));
                }
            });
        }).start();
    }

    interface Answer {
        void done(boolean ok);
    }

    /** Show a self-signed certificate's fingerprint and ask whether it is this router's. */
    private void askTrust(String host, X509Certificate cert, Answer answer) {
        new AlertDialog.Builder(this)
                .setTitle("Trust this router’s certificate?")
                .setMessage(host + " uses a certificate no authority has signed, which is normal for a router.\n\n"
                        + "SHA-256 fingerprint:\n" + Pins.sha256(cert) + "\n\n"
                        + "Accept it only if this is your router. If the certificate ever changes, you’ll be asked again.")
                .setPositiveButton("Trust", (d, w) -> {
                    pins.pin(host, cert);
                    answer.done(true);
                })
                .setNegativeButton("Cancel", (d, w) -> answer.done(false))
                .setOnCancelListener(d -> answer.done(false))
                .show();
    }

    // ------------------------------------------------------------- watchdog --

    private final Runnable probe = this::probe;

    /** (Re)schedule the next check, `delay` ms from now. */
    private void watch(long delay) {
        ui.removeCallbacks(probe);
        if (resumed) ui.postDelayed(probe, delay);
    }

    /**
     * Does the router still answer? Only while the UI is showing: a few
     * missed answers in a row (quickly re-checked) count as a lost connection,
     * which goes back to the address form. While the UI says it is waiting
     * for the router to restart, minutes of silence are expected.
     */
    private void probe() {
        final RouterAddress a = router;
        if (!resumed || probing || a == null || web == null || web.getParent() == null || !webLoaded) {
            watch(PROBE_MS);
            return;
        }
        probing = true;
        new Thread(() -> {
            final String why = Net.reach(a, pins);
            ui.post(() -> {
                probing = false;
                if (a != router || web == null || web.getParent() == null || !webLoaded) {
                    probeFails = 0;
                    watch(PROBE_MS);
                } else if (why == null) {
                    probeFails = 0;
                    watch(PROBE_MS);
                } else if (++probeFails >= (waiting ? LOST_AFTER_WAITING : LOST_AFTER)) {
                    lost(why);
                } else {
                    watch(waiting ? PROBE_MS : 3000);
                }
            });
        }).start();
    }

    /** Back to the address form; the UI is loaded afresh once connected again. */
    private void lost(String why) {
        probeFails = 0;
        waiting = false;
        webLoaded = false;
        showSetup(why != null && !why.isEmpty() ? why : "no answer", true);
    }

    // ------------------------------------------------------------------ web --

    private void showWebView() {
        if (web.getParent() == null) show(web);
    }

    private void showWeb(Bundle saved) {
        if (web == null) web = makeWebView();
        webLoaded = false;
        show(web);
        if (saved != null && web.restoreState(saved) != null) {
            webLoaded = true;
        } else {
            web.loadUrl(router.ui());
        }
    }

    private String versionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "1";
        }
    }

    private WebView makeWebView() {
        WebView w = new WebView(this);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);       // the UI keeps its session and theme in localStorage
        s.setSupportMultipleWindows(true);  // so target=_blank reaches onCreateWindow
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setBuiltInZoomControls(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + " HikariWrtApp/" + versionName());
        w.addJavascriptInterface(new Bridge(), "HikariApp");

        w.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                pageUrl = url;
                waiting = false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageUrl = url;
                webLoaded = true;
            }

            @Override
            public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                pageUrl = url;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (router.sameOrigin(u)) return false;
                String scheme = u.getScheme() == null ? "" : u.getScheme();
                String path = u.getPath() == null ? "/" : u.getPath();
                // The web UI's "the router moved to a new address" link: follow it,
                // and remember the new address for the next launch.
                if (req.isForMainFrame() && (scheme.equals("http") || scheme.equals("https"))
                        && RouterAddress.isPrivateV4(u.getHost()) && (path.equals("/") || path.isEmpty() || path.startsWith("/webui"))) {
                    RouterAddress moved = new RouterAddress(scheme, u.getHost(), u.getPort());
                    rekeyLogin(router, moved);
                    router = moved;
                    prefs.edit().putString(PREF_ADDRESS, router.base()).apply();
                    return false;
                }
                openOutside(u);
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError error) {
                if (req.isForMainFrame() && view == web && view.getParent() != null) lost(String.valueOf(error.getDescription()));
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest req, WebResourceResponse res) {
                if (req.isForMainFrame() && res.getStatusCode() == 404 && req.getUrl().getPath() != null
                        && req.getUrl().getPath().startsWith("/webui")) {
                    webLoaded = false;
                    showSetup(router.display() + " answers, but the HikariWrt web UI isn’t installed on it (nothing at /webui/).", false);
                }
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                X509Certificate cert = error.getCertificate() != null ? error.getCertificate().getX509Certificate() : null;
                String host = Uri.parse(error.getUrl()).getHost();
                if (cert == null || host == null || router == null || !host.equalsIgnoreCase(router.host)) {
                    handler.cancel();
                    return;
                }
                if (pins.matches(host, cert)) {
                    handler.proceed();
                    return;
                }
                askTrust(host, cert, ok -> {
                    if (ok) handler.proceed();
                    else handler.cancel();
                });
            }

            @Override
            public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                // The page's renderer crashed or was reclaimed: start over rather than die with it.
                if (web == view) {
                    content.removeView(view);
                    view.destroy();
                    web = null;
                    showWeb(null);
                }
                return true;
            }
        });

        w.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                // The UI's accept lists are mostly extensions (.bin, .itb, .tgz,
                // .conf) that Android's picker can't filter on; everything is
                // offered and the web UI checks what it got.
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try {
                    startActivityForResult(i, REQ_FILE);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    cb.onReceiveValue(null);
                    toast("No file picker on this phone");
                }
                return true;
            }

            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                // target=_blank (links in SMS messages): catch the URL in a
                // throwaway WebView and hand it to the right place.
                WebView catcher = new WebView(view.getContext());
                catcher.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                        Uri u = req.getUrl();
                        if (router != null && router.sameOrigin(u)) web.loadUrl(u.toString());
                        else openOutside(u);
                        v.destroy();
                        return true;
                    }
                });
                ((WebView.WebViewTransport) resultMsg.obj).setWebView(catcher);
                resultMsg.sendToTarget();
                return true;
            }
        });

        // Plain GET downloads, should the UI ever offer one: fetched natively
        // into Downloads, like the backup.
        w.setDownloadListener((url, userAgent, disposition, mime, length) -> {
            Uri u = Uri.parse(url);
            if (router == null || !router.sameOrigin(u)) {
                openOutside(u);
                return;
            }
            saveToDownloads(u.getEncodedPath() + (u.getEncodedQuery() != null ? "?" + u.getEncodedQuery() : ""), null,
                    URLUtil.guessFileName(url, disposition, mime), mime != null ? mime : "application/octet-stream", null);
        });
        return w;
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
        }
    }

    private void openOutside(Uri u) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException e) {
            toast("No app can open " + u);
        }
    }

    /** The router moved to a new address (the UI's own link): the saved sign-in moves with it. */
    private void rekeyLogin(RouterAddress from, RouterAddress to) {
        String s = prefs.getString(PREF_LOGIN, null);
        if (s == null || from == null) return;
        try {
            JSONObject o = new JSONObject(Vault.open(s));
            if (from.base().equals(o.optString("router"))) {
                o.put("router", to.base());
                prefs.edit().putString(PREF_LOGIN, Vault.seal(o.toString())).apply();
            }
        } catch (Exception e) {
            prefs.edit().remove(PREF_LOGIN).apply();
        }
    }

    private void toast(String s) {
        ui.post(() -> Toast.makeText(this, s, Toast.LENGTH_LONG).show());
    }

    /**
     * Fetch `path` from the router straight into Downloads (MediaStore: no
     * storage permission on Android 10+). A failed or refused download is
     * removed again rather than left as a broken file.
     */
    private void saveToDownloads(String path, Map<String, String> fields, String filename, String mime, byte[] magic) {
        final RouterAddress a = router;
        final String name = filename.replaceAll("[\\\\/:*?\"<>|]", "_");
        new Thread(() -> {
            ContentResolver cr = getContentResolver();
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
            v.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri item = null;
            try {
                item = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (item == null) throw new java.io.IOException("Downloads isn’t available");
                try (OutputStream out = cr.openOutputStream(item)) {
                    Net.fetch(a, pins, path, fields, magic, out);
                }
                ContentValues done = new ContentValues();
                done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                cr.update(item, done, null, null);
                toast("Saved to Downloads: " + name);
            } catch (Exception e) {
                if (item != null) cr.delete(item, null, null);
                toast("Download failed: " + e.getMessage());
            }
        }).start();
    }

    // --------------------------------------------------------------- bridge --

    /**
     * window.HikariApp. Every call checks that the page asking is the
     * router's own: an outside page never loads in this WebView (links leave
     * for the browser), and this makes sure of it.
     */
    final class Bridge {
        private boolean fromRouter() {
            RouterAddress r = router;
            return r != null && r.sameOrigin(Uri.parse(pageUrl));
        }

        @JavascriptInterface
        public String version() {
            return versionName();
        }

        /**
         * The colours at the top and bottom edge of the UI ("#rrggbb" - its
         * app bar and its bottom navigation) and whether it's dark: tint the
         * system bars to match.
         */
        @JavascriptInterface
        public void setBars(String top, String bottom, boolean dark) {
            if (!fromRouter()) return;
            final int t, b;
            try {
                t = Color.parseColor(top);
                b = Color.parseColor(bottom);
            } catch (Exception e) {
                return;
            }
            ui.post(() -> {
                if (web != null && web.getParent() != null) tintBars(t, b, dark);
            });
        }

        /** navigator.clipboard needs a secure context, which http://router isn't. */
        @JavascriptInterface
        public boolean copy(String text) {
            if (!fromRouter() || text == null) return false;
            ui.post(() -> {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                cm.setPrimaryClip(ClipData.newPlainText("HikariWrt", text));
                // Android 13+ confirms a copy on its own.
                if (Build.VERSION.SDK_INT < 33) Toast.makeText(MainActivity.this, "Copied", Toast.LENGTH_SHORT).show();
            });
            return true;
        }

        /**
         * A download the web UI makes as a form POST (the backup: cgi-backup
         * wants the session id posted), which a WebView can't hand to a
         * download listener. Only paths under /cgi-bin/ on the router.
         */
        @JavascriptInterface
        public boolean download(String path, String fieldsJson, String filename) {
            if (!fromRouter() || path == null || !path.startsWith("/cgi-bin/")) return false;
            Map<String, String> fields = new LinkedHashMap<>();
            try {
                JSONObject o = new JSONObject(fieldsJson == null ? "{}" : fieldsJson);
                for (Iterator<String> it = o.keys(); it.hasNext(); ) {
                    String k = it.next();
                    fields.put(k, o.getString(k));
                }
            } catch (Exception e) {
                return false;
            }
            boolean gz = filename != null && (filename.endsWith(".tar.gz") || filename.endsWith(".tgz"));
            saveToDownloads(path, fields, filename != null ? filename : "download",
                    gz ? "application/gzip" : "application/octet-stream", gz ? new byte[] {0x1f, (byte) 0x8b} : null);
            return true;
        }

        /**
         * "Remember me" on the login page: keep this sign-in, sealed by the
         * Keystore and tied to this router's address, so opening the app signs
         * in again by itself.
         */
        @JavascriptInterface
        public boolean saveLogin(String user, String password) {
            RouterAddress r = router;
            if (!fromRouter() || r == null || user == null || password == null) return false;
            try {
                JSONObject o = new JSONObject().put("router", r.base()).put("user", user).put("password", password);
                prefs.edit().putString(PREF_LOGIN, Vault.seal(o.toString())).apply();
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        /** The remembered sign-in for this router as {"user","password"} JSON, or "". */
        @JavascriptInterface
        public String savedLogin() {
            RouterAddress r = router;
            String s = prefs.getString(PREF_LOGIN, null);
            if (!fromRouter() || r == null || s == null) return "";
            try {
                JSONObject o = new JSONObject(Vault.open(s));
                if (!r.base().equals(o.optString("router"))) return "";
                return new JSONObject().put("user", o.getString("user")).put("password", o.getString("password")).toString();
            } catch (Exception e) {
                // The Keystore key is gone (a reset lock screen can do that): nothing to offer.
                prefs.edit().remove(PREF_LOGIN).apply();
                return "";
            }
        }

        /** Sign out, untick "Remember me", or a saved password that stopped working. */
        @JavascriptInterface
        public void forgetLogin() {
            if (fromRouter()) prefs.edit().remove(PREF_LOGIN).apply();
        }

        /**
         * The UI is waiting for a restart or firmware upgrade it started: the
         * router is meant to be away for minutes, so the watchdog holds off.
         */
        @JavascriptInterface
        public void waiting(boolean on) {
            if (fromRouter()) waiting = on;
        }
    }
}
