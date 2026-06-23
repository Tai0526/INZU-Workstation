/**
 * Cross-tab / cross-window live sync.
 *
 * Each localStorage-backed store registers a reload callback for its key. When a
 * DIFFERENT tab or window of the SAME browser writes that key, the browser fires
 * a `storage` event here and we rehydrate the store's cache and notify its React
 * listeners — so a handoff made by one logged-in user appears live for another
 * user signed in in another window, with no manual refresh.
 *
 * Scope & limits (by design — this is the shell phase, no server yet):
 *   • The `storage` event fires only in OTHER tabs/windows, never in the tab that
 *     made the change (that path already notified its own listeners synchronously).
 *   • It cannot cross to a *different browser* (Chrome ↔ Firefox): each browser has
 *     its own isolated localStorage. Sharing data across different browsers needs
 *     the real backend. For multi-user testing on one machine, open several windows
 *     (or tabs) of the same browser and log in as a different user in each — the
 *     session is kept per-tab (sessionStorage) so each window is its own user.
 */

type Reload = (newValue: string | null) => void

const reloaders = new Map<string, Reload>()
let attached = false

function attach() {
  if (attached || typeof window === 'undefined') return
  attached = true
  window.addEventListener('storage', (e) => {
    // Only react to localStorage (shared data) — never to sessionStorage (per-tab session).
    if (e.storageArea && e.storageArea !== window.localStorage) return
    // e.key === null means localStorage.clear() — reload everything.
    if (e.key === null) {
      reloaders.forEach((r) => r(null))
      return
    }
    const r = reloaders.get(e.key)
    if (r) r(e.newValue)
  })
}

/**
 * Register a store for cross-tab sync. `reload` must invalidate the store's cache
 * and notify its in-tab listeners. It receives the new raw string value from the
 * storage event (or null on remove/clear) for stores that prefer to hydrate from
 * the payload instead of re-reading localStorage.
 */
export function registerCrossTabSync(key: string, reload: Reload) {
  attach()
  reloaders.set(key, reload)
}
