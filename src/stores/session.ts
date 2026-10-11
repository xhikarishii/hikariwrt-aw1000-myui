// Login state. The rpcd session id is the only credential the browser
// holds; the password is sent once to session.login and never stored. (In
// the Android app, "Remember me" keeps it - in the app, sealed by the phone's
// Keystore, not in the page's storage.)

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { call, listObjects, login as ubusLogin, setSession } from '@/api/ubus'
import { board as fetchBoard, type Board } from '@/api/router'
import { setupDone as fetchSetupDone } from '@/api/setup'
import { load, remove, save } from '@/utils/storage'
import { rememberLogin } from '@/utils/app'

const KEY = 'hikari.session'

export const useSession = defineStore('session', () => {
  const saved = load<{ sid: string | null; username: string }>(KEY, { sid: null, username: 'root' })
  const sid = ref<string | null>(saved.sid)
  const username = ref(saved.username)
  const board = ref<Board | null>(null)
  // luci.aw1000-* rpcd objects present on this router. Pages backed by a
  // feed package the image doesn't include are hidden instead of erroring.
  const objects = ref<Set<string>>(new Set())
  const loggedIn = computed(() => sid.value !== null && board.value !== null)
  // First run: noPassword is set by the login page when a blank-password
  // login succeeds (root has no password yet). setupDone mirrors
  // hikariui.setup.done (null = no such config: treat as done).
  // setupDismissed is "Set up later" for this session.
  const noPassword = ref(false)
  const setupDone = ref<boolean | null>(null)
  const setupDismissed = ref(false)
  const needsSetup = computed(() => noPassword.value || (setupDone.value === false && !setupDismissed.value))

  setSession(sid.value)

  async function login(user: string, password: string): Promise<void> {
    const r = await ubusLogin(user, password)
    sid.value = r.ubus_rpc_session
    username.value = user
    setSession(sid.value)
    save(KEY, { sid: sid.value, username: user })
    await loadRouter()
  }

  async function loadRouter(): Promise<void> {
    const [b, objs, done] = await Promise.all([fetchBoard(), listObjects('luci.aw1000-*').catch(() => []), fetchSetupDone()])
    objects.value = new Set(objs)
    setupDone.value = done
    board.value = b
  }

  function has(object: string): boolean {
    return objects.value.has(object)
  }

  /** On startup: is the remembered session still alive? */
  async function restore(): Promise<boolean> {
    if (!sid.value) return false
    try {
      await loadRouter()
      return true
    } catch {
      forget()
      return false
    }
  }

  async function logout(): Promise<void> {
    // Forget first so a failing destroy can't trip the "session expired"
    // handler. Best effort: an expired session can't destroy itself, and
    // that's fine. The hikari-ui rpcd ACL grants session.destroy; stock
    // ACLs don't, so without the package installed the session just idles
    // out on the router.
    // Signing out also ends the app's "Remember me": it would sign straight back in.
    const old = sid.value
    rememberLogin(null)
    forget()
    if (old) await call('session', 'destroy', {}, { sid: old }).catch(() => undefined)
  }

  /** Adopt a session obtained elsewhere (the blank-password first-run login). */
  async function adopt(newSid: string, user = 'root'): Promise<void> {
    sid.value = newSid
    username.value = user
    setSession(newSid)
    save(KEY, { sid: newSid, username: user })
    await loadRouter()
  }

  function forget(): void {
    sid.value = null
    board.value = null
    noPassword.value = false
    setupDone.value = null
    setSession(null)
    remove(KEY)
  }

  return { sid, username, board, objects, loggedIn, noPassword, setupDone, setupDismissed, needsSetup, has, login, adopt, restore, logout, forget }
})
