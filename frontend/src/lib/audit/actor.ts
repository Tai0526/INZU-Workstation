import type { RoleKey } from '@/lib/roles'

/**
 * The "who is acting" context for audit stamping. The AuthContext keeps this in
 * sync with the signed-in (mock) user, so data stores can attribute every
 * create/edit without threading the user through every call. With a real backend
 * this attribution comes from the authenticated request instead.
 */
export interface Actor {
  name: string
  role: RoleKey | 'system'
}

let current: Actor = { name: 'System', role: 'system' }

export function setActor(a: Actor) {
  current = a
}

export function getActor(): Actor {
  return current
}
