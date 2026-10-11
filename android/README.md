# HikariWrt for Android

The router's web UI (`/webui/`) in its own app: full screen, no browser bar,
over the router's plain HTTP. Package `moe.hikarishii.hikariwrt`, Android 10+
(minSdk 29, targetSdk 36), about 45 kB.

## Getting it onto a phone

- **From the router:** `npm run package` ships the APK in the `hikari-ui`
  package, at `/webui/HikariWrt.apk`. On an Android phone's browser, the
  System page shows a "HikariWrt for Android" card with a download button.
  The browser asks once to be allowed to install apps.
- **By hand:** copy `android/build/HikariWrt.apk` to the phone.

## What the app does

- **First launch:** a setup screen asks for the router's address. Type the IP,
  e.g. `10.10.0.1`, optionally with `:port` or `https://`. The phone's current
  gateway is offered as a tap-to-fill suggestion, never used unasked.
- **Connect checks before saving.** It confirms `/webui/` is the HikariWrt UI,
  and says plainly when the address is:
  - an OpenWrt router without the UI;
  - something else entirely;
  - not answering.
- **After that,** it opens straight into the UI. "Change router address" is in
  the launcher long-press menu.
- **Lost connection:** the app goes back to the address form, with the saved
  address filled in and what went wrong. That happens when the router doesn't
  answer on opening, or stops answering while the UI is open. Meanwhile:
  - the form tries the address again every 5 s and returns to the UI by
    itself once the router answers;
  - typing a different address stops the retrying.

  While the UI is showing, a watchdog asks the router for `/webui/` (a HEAD
  request):
  - every 15 s;
  - at once when the phone's network changes or the app comes back to the
    front.

  Three misses in a row, 3 s apart, count as lost, about 15 s in all. A
  restart or firmware upgrade the UI started tells the app to wait (the
  `waiting` call), and then it allows 8 minutes.
- **Remember me:** an option on the login page, in the app only. Signing in
  with it on keeps the user name and password, and opening the app (or an
  expired session) signs in again by itself.
  - **Storage:** sealed with an AES-GCM key held in the Android Keystore, in
    the app's private preferences. The app is excluded from backups.
  - **Scope:** tied to the router's address. When the UI's "moved to a new
    address" link is followed, the saved login moves with it.
  - **Forgotten** on signing out, on unticking it at the next sign-in, or
    when the saved password stops working.
- **Links:**
  - the router's own pages, LuCI included, stay in the app;
  - links to other sites (in SMS messages, say) open in the phone's browser;
  - the UI's "the router moved to a new address" link is followed, and the
    new address is remembered.
- **File pickers:** backup restore, firmware upload and WireGuard import work.
  Everything is offered, because the UI's `accept` lists are file extensions
  Android can't filter on.
- **HTTPS with the router's self-signed certificate:** the fingerprint is shown
  once to accept, then pinned for that host. A different certificate is asked
  about again.

### `window.HikariApp`

For what a WebView can't do by itself. The web UI uses it through
`src/utils/app.ts`, and every call is refused unless the page is the router's.

| Call | Why |
|---|---|
| `setBars(top, bottom, dark)` | The status and navigation bars take the UI's app-bar and bottom-navigation colours, and light or dark icons. |
| `copy(text)` | `navigator.clipboard` needs a secure context, which `http://router` isn't (used for the mesh join code). |
| `download(path, fieldsJson, filename)` | The backup is a form POST, which a WebView can't hand to a download listener. The app re-issues it and saves into Downloads (MediaStore, no storage permission). A refused request isn't saved as a broken file. |
| `saveLogin(user, password)`, `savedLogin()`, `forgetLogin()` | "Remember me". `savedLogin()` returns `{"user","password"}` JSON for this router's address, or `""`. |
| `waiting(on)` | The offline overlay is up: the router is meant to be away (restart, firmware), so the watchdog holds off. |
| `version()` | The app's version. The user agent also ends in `HikariWrtApp/<version>`. |

## Building

`./build.sh` builds `build/HikariWrt.apk` with the SDK's own tools. There's no
Gradle or AndroidX; the whole app is five Java files and a few resources.
The pipeline is `aapt2` → `javac --release 17` → `d8` → `zipalign` →
`apksigner`.

It needs:

- **Android SDK:** `ANDROID_SDK`, default `~/.local/opt/android-sdk`, with
  `build-tools;37.0.0` and `platforms;android-36`:
  ```
  sdkmanager --sdk_root=$HOME/.local/opt/android-sdk "build-tools;37.0.0" "platforms;android-36"
  ```
- **JDK:** 17 or newer.

Versions: `versionName` is the web UI's `package.json` version. `versionCode`
is minutes since the epoch, so each build installs over the previous one.

### The signing key

The first build makes `~/.local/share/hikariwrt-android/release.jks`, with its
password in `keystore.pass` next to it. It's kept outside the repo on purpose.

**Back it up.** Android installs an update only when it's signed with the same
key. A build signed with a new key has to be installed fresh, after
uninstalling the old app, which loses its saved router address.

## Files

| File | What |
|---|---|
| `AndroidManifest.xml` | Two permissions (INTERNET, ACCESS_NETWORK_STATE), one activity, predictive back |
| `src/.../MainActivity.java` | Setup and web screens, the connection watchdog, the WebView and its clients, the bridge |
| `src/.../RouterAddress.java` | Parsing what was typed, same-origin checks, private-address test |
| `src/.../Net.java` | The Connect check, the watchdog's probe, and native downloads |
| `src/.../Vault.java` | Keystore AES-GCM sealing for the remembered sign-in |
| `src/.../Pins.java` | Accept-once certificate pinning for HTTPS |
| `res/` | Adaptive icon (the favicon's sun on the seed colour), theme, cleartext config, launcher shortcut |
