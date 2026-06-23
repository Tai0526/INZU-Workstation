import { useEffect, useState } from 'react'

/**
 * Tiny IndexedDB wrapper for storing uploaded files (PDFs, photos) during the
 * shell phase. localStorage can't hold binary documents; IndexedDB can. When the
 * backend arrives this is replaced by real object storage (e.g. Cloudflare R2).
 */

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

export async function putFile(id: string, blob: Blob): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(blob, id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function getFile(id: string): Promise<Blob | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(id)
    req.onsuccess = () => resolve((req.result as Blob) ?? null)
    req.onerror = () => reject(req.error)
  })
}

export async function deleteFile(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** Wipe every stored file (used by the Admin data reset). */
export async function clearAllFiles(): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** Open a stored file in a new tab (PDFs/images), or download it. */
export async function viewFile(id: string, fileName: string): Promise<boolean> {
  const blob = await getFile(id)
  if (!blob) return false
  const url = URL.createObjectURL(blob)
  const win = window.open(url, '_blank')
  if (!win) {
    // popup blocked — fall back to download
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return true
}

/** React hook: resolve a stored file id to an object URL (for inline <img> previews). */
export function useFileUrl(fileId?: string): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let revoked = false
    let objUrl: string | null = null
    if (!fileId) {
      setUrl(null)
      return
    }
    getFile(fileId).then((blob) => {
      if (blob && !revoked) {
        objUrl = URL.createObjectURL(blob)
        setUrl(objUrl)
      }
    }).catch(() => { /* missing/unreadable file — leave url null */ })
    return () => {
      revoked = true
      if (objUrl) URL.revokeObjectURL(objUrl)
    }
  }, [fileId])
  return url
}
