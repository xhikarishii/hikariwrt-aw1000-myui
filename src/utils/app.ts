// The Android app (android/ in this repo) runs this UI in a WebView and adds
// window.HikariApp for the few things a WebView can't do by itself. In a
// normal browser there is no bridge and each helper falls back to the web way.

interface HikariAppBridge {
  version(): string
  /** Tint the phone's status bar (top) and navigation bar (bottom): "#rrggbb", dark or not. */
  setBars(top: string, bottom: string, dark: boolean): void
  /** ClipboardManager: navigator.clipboard needs a secure context, which http://router isn't. */
  copy(text: string): boolean
  /** A download made as a form POST (the backup), saved natively into Downloads. */
  download(path: string, fieldsJson: string, filename: string): boolean
  // "Remember me" and the connection watchdog: newer app builds only, so
  // each is checked for before use.
  /** Keep this sign-in (sealed by the phone's Keystore) for when the app is opened again. */
  saveLogin?(user: string, password: string): boolean
  /** The remembered sign-in for this router as {"user","password"} JSON, or "". */
  savedLogin?(): string
  forgetLogin?(): void
  /** The router is meant to be away for a while (restart, firmware): don't treat it as a lost connection. */
  waiting?(on: boolean): void
}

function bridge(): HikariAppBridge | null {
  const b = (globalThis as { HikariApp?: HikariAppBridge }).HikariApp
  return b && typeof b.version === 'function' ? b : null
}

/** Running inside the HikariWrt Android app. */
export function inApp(): boolean {
  return bridge() !== null
}

/** Copy text: the app's clipboard, else the browser's. True when it worked. */
export async function copyText(text: string): Promise<boolean> {
  const b = bridge()
  if (b) return b.copy(text)
  // Typed narrowly: this file is also checked without the DOM lib (the tests).
  const clip = (globalThis.navigator as { clipboard?: { writeText(t: string): Promise<void> } } | undefined)?.clipboard
  try {
    if (!clip) return false
    await clip.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Match the phone's system bars to the UI's top and bottom edges (the app only; a no-op in browsers). */
export function setBars(top: string, bottom: string, dark: boolean): void {
  bridge()?.setBars(top, bottom, dark)
}

/** Hand a POST download to the app. False when not in the app (use the web way). */
export function appDownload(path: string, fields: Record<string, string>, filename: string): boolean {
  const b = bridge()
  return b ? b.download(path, JSON.stringify(fields), filename) : false
}

/** The app can remember the sign-in. */
export function canRemember(): boolean {
  return typeof bridge()?.saveLogin === 'function'
}

/** Remember (or, with null, forget) this sign-in in the app. */
export function rememberLogin(login: { user: string; password: string } | null): void {
  const b = bridge()
  if (login) b?.saveLogin?.(login.user, login.password)
  else b?.forgetLogin?.()
}

/** The sign-in the app remembers for this router, if any. */
export function savedLogin(): { user: string; password: string } | null {
  try {
    const raw = bridge()?.savedLogin?.()
    if (!raw) return null
    const o = JSON.parse(raw) as { user?: unknown; password?: unknown }
    return typeof o.user === 'string' && typeof o.password === 'string' ? { user: o.user, password: o.password } : null
  } catch {
    return null
  }
}

/** Tell the app the router is meant to be unreachable for a while (or no longer). */
export function appWaiting(on: boolean): void {
  bridge()?.waiting?.(on)
}

/** An Android phone's browser (not the app): where offering the app makes sense. */
export function androidBrowser(ua = navigator.userAgent): boolean {
  return /Android/i.test(ua) && !/HikariWrtApp\//.test(ua) && !inApp()
}
