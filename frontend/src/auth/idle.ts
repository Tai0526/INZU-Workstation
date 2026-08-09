/**
 * Inactivity sign-out. After IDLE_TIMEOUT_MS with no interaction the user must
 * sign in again — a shared machine left unlocked shouldn't stay in the app.
 *
 * How it works
 *  - Every interaction (click, key, scroll, touch, mouse move) stamps a
 *    last-active time in localStorage. Writes are throttled to one per 30 s.
 *  - A watcher (armed while signed in) checks the stamp once a minute and on
 *    tab wake-up; past the limit it fires the sign-out callback.
 *  - On app load, AuthContext checks the stamp BEFORE restoring the session,
 *    so coming back after 2+ hours lands on the login page — no flash of data.
 *  - The stamp lives in localStorage so it is shared across tabs: activity in
 *    any tab keeps them all alive, and a closed tab still counts against you.
 *
 * The stamp is never deleted — signing in re-stamps it. That way, if a
 * sign-out only half-completes (e.g. offline), the next load still sees the
 * stale stamp and finishes the job instead of silently resurrecting the session.
 */

export const IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000 // 2 hours
const WRITE_EVERY_MS = 30_000 // stamp writes are throttled to this
const CHECK_EVERY_MS = 60_000 // watcher poll interval

const LS_STAMP = 'inzu_last_active'
const LS_NOTICE = 'inzu_idle_signed_out'

// Last time THIS tab wrote the stamp — a fast path so high-frequency events
// (mousemove) don't hit localStorage on every fire.
let lastWrite = 0

/** Record activity now. Throttled unless `force`. */
export function stampActivity(force = false) {
  const now = Date.now()
  if (!force && now - lastWrite < WRITE_EVERY_MS) return
  lastWrite = now
  try { localStorage.setItem(LS_STAMP, String(now)) } catch { /* storage full/blocked — watcher then relies on in-memory time */ }
}

/** True when the last activity (any tab) is more than IDLE_TIMEOUT_MS ago. */
export function idleExpired(): boolean {
  const now = Date.now()
  // Our own tab stamped recently — cannot be expired, skip the storage read.
  if (lastWrite !== 0 && now - lastWrite < IDLE_TIMEOUT_MS) return false
  let raw: string | null = null
  try { raw = localStorage.getItem(LS_STAMP) } catch { /* ignore */ }
  if (!raw) return false // no stamp yet (first run after deploy) — start the clock instead of kicking
  const last = Number(raw)
  if (!Number.isFinite(last)) return false
  if (last > now + 60_000) { stampActivity(true); return false } // clock moved backwards — reset rather than punish
  return now - last > IDLE_TIMEOUT_MS
}

/** Flag why the next login page should say "signed out for inactivity". */
export function noteIdleSignout() {
  try { localStorage.setItem(LS_NOTICE, '1') } catch { /* ignore */ }
}

/** Read-and-clear the inactivity notice (shown once on the login page). */
export function consumeIdleSignoutNotice(): boolean {
  try {
    const set = localStorage.getItem(LS_NOTICE) === '1'
    if (set) localStorage.removeItem(LS_NOTICE)
    return set
  } catch { return false }
}

const EVENTS: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove', 'scroll']

/**
 * Arm the watcher. Returns a cleanup function. `onExpired` fires at most once.
 *
 * Order matters everywhere here: expiry is checked BEFORE stamping — on arm,
 * on wake-up, and on every interaction — so a return after a long absence
 * signs the user out instead of resetting the clock and erasing the evidence.
 */
export function startIdleWatch(onExpired: () => void): () => void {
  let fired = false
  const fire = () => { if (!fired) { fired = true; onExpired() } }
  const check = () => { if (idleExpired()) fire() }

  // Arming with an already-expired stamp (a session restored 2+ hours later
  // by a path that skipped the load-time gate) must sign out immediately —
  // NOT stamp fresh activity over the stale one.
  if (idleExpired()) {
    fire()
    return () => { /* nothing armed */ }
  }

  const onActivity = () => {
    if (fired) return
    if (idleExpired()) { fire(); return }
    stampActivity()
  }
  // Timers are throttled or suspended in background tabs and during sleep —
  // the wake-up event is what reliably catches "came back 3 hours later".
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return
    check()
    if (!fired) stampActivity(true) // returning to the tab is usage
  }

  stampActivity(true) // arming (login / app load with a live session) is usage
  EVENTS.forEach((e) => window.addEventListener(e, onActivity, { capture: true, passive: true }))
  document.addEventListener('visibilitychange', onVisible)
  const timer = window.setInterval(check, CHECK_EVERY_MS)

  return () => {
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
    EVENTS.forEach((e) => window.removeEventListener(e, onActivity, { capture: true }))
  }
}
