package moe.hikarishii.hikariwrt;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.PushbackInputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.cert.X509Certificate;
import java.util.Map;

import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLException;

/** The few HTTP requests the app makes itself, off the UI thread. */
final class Net {
    private Net() {}

    private static final int TIMEOUT_MS = 5000;

    /** What the setup screen's Connect found at an address. */
    static final class Check {
        enum Kind { OK, NO_ANSWER, CERT_UNTRUSTED, OPENWRT_NO_UI, NOT_ROUTER }

        final Kind kind;
        final String detail;
        final X509Certificate cert;

        Check(Kind kind, String detail, X509Certificate cert) {
            this.kind = kind;
            this.detail = detail;
            this.cert = cert;
        }
    }

    private static HttpURLConnection open(RouterAddress a, Pins pins, String path) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(a.base() + path).openConnection();
        c.setConnectTimeout(TIMEOUT_MS);
        c.setReadTimeout(TIMEOUT_MS);
        c.setInstanceFollowRedirects(false);
        c.setUseCaches(false);
        if (c instanceof HttpsURLConnection) pins.apply((HttpsURLConnection) c, a.host);
        return c;
    }

    private static Pins.Untrusted untrusted(Throwable t) {
        for (; t != null; t = t.getCause()) if (t instanceof Pins.Untrusted) return (Pins.Untrusted) t;
        return null;
    }

    private static String readSome(InputStream in, int max) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while (b.size() < max && (n = in.read(buf)) > 0) b.write(buf, 0, n);
        return b.toString(StandardCharsets.UTF_8.name());
    }

    /**
     * Is this a HikariWrt router? The web UI's page says so in its title. When
     * it doesn't, a ubus answer still tells "an OpenWrt router without the web
     * UI" apart from "something else entirely", which is worth saying.
     */
    static Check check(RouterAddress a, Pins pins) {
        HttpURLConnection c = null;
        try {
            c = open(a, pins, "/webui/");
            int code = c.getResponseCode();
            if (code == 200) {
                String body = readSome(c.getInputStream(), 64 * 1024);
                if (body.contains("<title>HikariWrt</title>")) return new Check(Check.Kind.OK, null, null);
            }
        } catch (IOException e) {
            Pins.Untrusted u = untrusted(e);
            if (u != null) return new Check(Check.Kind.CERT_UNTRUSTED, null, u.cert);
            if (e instanceof SSLException) return new Check(Check.Kind.NO_ANSWER, "a secure connection could not be set up", null);
            return new Check(Check.Kind.NO_ANSWER, e.getMessage(), null);
        } finally {
            if (c != null) c.disconnect();
        }

        try {
            c = open(a, pins, "/ubus");
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            byte[] req = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"list\",\"params\":[\"00000000000000000000000000000000\",\"session\"]}"
                    .getBytes(StandardCharsets.UTF_8);
            try (OutputStream o = c.getOutputStream()) {
                o.write(req);
            }
            int code = c.getResponseCode();
            InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
            String body = in != null ? readSome(in, 8192) : "";
            if (body.contains("\"jsonrpc\"")) return new Check(Check.Kind.OPENWRT_NO_UI, null, null);
        } catch (IOException e) {
            // answered /webui/ with something, but no ubus: not a router of ours
        } finally {
            if (c != null) c.disconnect();
        }
        return new Check(Check.Kind.NOT_ROUTER, null, null);
    }

    /**
     * The connection watchdog's probe: does anything answer at the router's
     * address? Any HTTP reply counts, so a busy router isn't mistaken for a
     * lost one. Null when it answered, else why not.
     */
    static String reach(RouterAddress a, Pins pins) {
        HttpURLConnection c = null;
        try {
            c = open(a, pins, "/webui/");
            c.setConnectTimeout(4000);
            c.setReadTimeout(4000);
            c.setRequestMethod("HEAD");
            c.getResponseCode();
            return null;
        } catch (IOException e) {
            if (untrusted(e) != null) return "the router’s certificate changed";
            return e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /**
     * Fetch a file the web UI asked for and stream it to `out`: a form POST
     * when `fields` is given (the backup, which cgi-backup only hands out to a
     * POST carrying the session id), else a GET.
     *
     * When `magic` is given the body must start with those bytes; cgi-backup
     * answers a refused request with a short text, and that must not end up
     * in Downloads looking like a backup.
     */
    static void fetch(RouterAddress a, Pins pins, String path, Map<String, String> fields, byte[] magic, OutputStream out)
            throws IOException {
        HttpURLConnection c = open(a, pins, path);
        try {
            c.setReadTimeout(60000);
            if (fields != null) {
                StringBuilder sb = new StringBuilder();
                for (Map.Entry<String, String> e : fields.entrySet()) {
                    if (sb.length() > 0) sb.append('&');
                    sb.append(URLEncoder.encode(e.getKey(), "UTF-8")).append('=').append(URLEncoder.encode(e.getValue(), "UTF-8"));
                }
                byte[] body = sb.toString().getBytes(StandardCharsets.UTF_8);
                c.setRequestMethod("POST");
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
                try (OutputStream o = c.getOutputStream()) {
                    o.write(body);
                }
            }
            int code = c.getResponseCode();
            if (code != 200) throw new IOException("the router answered " + code);
            try (PushbackInputStream in = new PushbackInputStream(c.getInputStream(), 16)) {
                if (magic != null) {
                    byte[] head = new byte[magic.length];
                    int n = 0, r;
                    while (n < head.length && (r = in.read(head, n, head.length - n)) > 0) n += r;
                    for (int i = 0; i < magic.length; i++) {
                        if (i >= n || head[i] != magic[i]) throw new IOException("the router did not send a backup");
                    }
                    in.unread(head, 0, n);
                }
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
        } finally {
            c.disconnect();
        }
    }
}
