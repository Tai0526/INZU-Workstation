import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase/client'

/**
 * File storage. When Supabase is configured, uploaded files live in the private
 * `documents` bucket (durable, replicated, opened via short-lived signed URLs) —
 * so they can't be lost with the browser. Otherwise (and as a read fallback for
 * files uploaded before the migration) they live in IndexedDB.
 */

const BUCKET = 'documents'
// Storage object keys allow a limited character set; keep ids stable + safe.
const keyOf = (id: string) => id.replace(/[^A-Za-z0-9._/-]/g, '_')

// ── IndexedDB (local fallback / legacy files) ───────────────────────────────
const DB_NAME = 'inzu_files'
const STORE = 'files'
const VERSION = 1

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
function idbGet(id: string): Promise<Blob | null> {
  return openDB().then((db) => new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(id)
    req.onsuccess = () => resolve((req.result as Blob) ?? null)
    req.onerror = () => reject(req.error)
  })).catch(() => null)
}
function idbPut(id: string, blob: Blob): Promise<void> {
  return openDB().then((db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(blob, id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  }))
}
function idbDelete(id: string): Promise<void> {
  return openDB().then((db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })).catch(() => {})
}
function idbClear(): Promise<void> {
  return openDB().then((db) => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })).catch(() => {})
}

// ── Public API ──────────────────────────────────────────────────────────────
export async function putFile(id: string, blob: Blob): Promise<void> {
  if (supabase) {
    const { error } = await supabase.storage.from(BUCKET).upload(keyOf(id), blob, {
      upsert: true,
      contentType: blob.type || undefined,
    })
    if (error) throw error
    return
  }
  await idbPut(id, blob)
}

export async function getFile(id: string): Promise<Blob | null> {
  if (supabase) {
    const { data } = await supabase.storage.from(BUCKET).download(keyOf(id))
    if (data) return data
  }
  // Fallback: a file uploaded before the migration (still in IndexedDB).
  return idbGet(id)
}

export async function deleteFile(id: string): Promise<void> {
  if (supabase) {
    await supabase.storage.from(BUCKET).remove([keyOf(id)])
  }
  await idbDelete(id)
}

/** Wipe stored files (used by the Admin data reset). */
export async function clearAllFiles(): Promise<void> {
  if (supabase) {
    try {
      const { data } = await supabase.storage.from(BUCKET).list('', { limit: 1000 })
      const names = (data ?? []).map((o) => o.name)
      if (names.length) await supabase.storage.from(BUCKET).remove(names)
    } catch { /* ignore */ }
  }
  await idbClear()
}

/** Open a stored file in a new tab (PDFs/images), or download it. */
export async function viewFile(id: string, fileName: string): Promise<boolean> {
  if (supabase) {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(keyOf(id), 60, { download: false })
    if (data?.signedUrl) {
      const win = window.open(data.signedUrl, '_blank')
      if (!win) { const a = document.createElement('a'); a.href = data.signedUrl; a.download = fileName; a.click() }
      return true
    }
  }
  const blob = await idbGet(id)
  if (!blob) return false
  const url = URL.createObjectURL(blob)
  const win = window.open(url, '_blank')
  if (!win) { const a = document.createElement('a'); a.href = url; a.download = fileName; a.click() }
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return true
}

/** React hook: resolve a stored file id to a URL (for inline <img> previews). */
export function useFileUrl(fileId?: string): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let revoked = false
    let objUrl: string | null = null
    if (!fileId) { setUrl(null); return }

    if (supabase) {
      supabase.storage.from(BUCKET).createSignedUrl(keyOf(fileId), 600).then(({ data }) => {
        if (data?.signedUrl && !revoked) { setUrl(data.signedUrl); return }
        // fall back to IndexedDB
        idbGet(fileId).then((blob) => {
          if (blob && !revoked) { objUrl = URL.createObjectURL(blob); setUrl(objUrl) }
        })
      }).catch(() => { /* leave null */ })
    } else {
      idbGet(fileId).then((blob) => {
        if (blob && !revoked) { objUrl = URL.createObjectURL(blob); setUrl(objUrl) }
      }).catch(() => { /* leave null */ })
    }

    return () => { revoked = true; if (objUrl) URL.revokeObjectURL(objUrl) }
  }, [fileId])
  return url
}
