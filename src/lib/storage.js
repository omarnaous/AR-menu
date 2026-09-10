// Dishes live in IndexedDB: a GLB is a few megabytes, which localStorage cannot
// hold. This is deliberately a thin, swappable layer — point saveItem/listItems
// at Supabase or Firebase and the rest of the app is unchanged. Until you do,
// a menu lives on the device that created it, so the QR codes only resolve for
// that browser.

const DB_NAME = 'ar-menu'
const DB_VERSION = 1
const ITEMS = 'items'
const ASSETS = 'assets'

let dbPromise = null

function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(ITEMS)) db.createObjectStore(ITEMS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(ASSETS)) db.createObjectStore(ASSETS)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return dbPromise
}

function tx(store, mode, run) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(store, mode)
        const request = run(transaction.objectStore(store))
        transaction.onerror = () => reject(transaction.error)
        transaction.oncomplete = () => resolve(request?.result)
      }),
  )
}

export function createId() {
  return `d_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export async function saveItem(item, assets = {}) {
  await tx(ITEMS, 'readwrite', (store) => store.put(item))
  const entries = Object.entries(assets).filter(([, blob]) => blob)
  if (entries.length) {
    await tx(ASSETS, 'readwrite', (store) => {
      for (const [kind, blob] of entries) store.put(blob, `${item.id}:${kind}`)
    })
  }
  return item
}

export function listItems() {
  return tx(ITEMS, 'readonly', (store) => store.getAll()).then((items) =>
    (items || []).sort((a, b) => b.createdAt - a.createdAt),
  )
}

export function getItem(id) {
  return tx(ITEMS, 'readonly', (store) => store.get(id))
}

export function getAsset(id, kind) {
  return tx(ASSETS, 'readonly', (store) => store.get(`${id}:${kind}`))
}

export async function deleteItem(id) {
  await tx(ITEMS, 'readwrite', (store) => store.delete(id))
  await tx(ASSETS, 'readwrite', (store) => {
    store.delete(`${id}:glb`)
    store.delete(`${id}:usdz`)
    store.delete(`${id}:thumb`)
  })
}

// A menu is portable: export it on the tablet that built it, import it on the
// phone at the pass. Replace with a real backend before you scale past one venue.
export async function exportMenu() {
  const items = await listItems()
  const payload = { version: 1, exportedAt: Date.now(), items: [] }
  for (const item of items) {
    const [glb, usdz, thumb] = await Promise.all([
      getAsset(item.id, 'glb'),
      getAsset(item.id, 'usdz'),
      getAsset(item.id, 'thumb'),
    ])
    payload.items.push({
      item,
      glb: glb ? await blobToDataUrl(glb) : null,
      usdz: usdz ? await blobToDataUrl(usdz) : null,
      thumb: thumb ? await blobToDataUrl(thumb) : null,
    })
  }
  return new Blob([JSON.stringify(payload)], { type: 'application/json' })
}

export async function importMenu(file) {
  const payload = JSON.parse(await file.text())
  if (!payload || payload.version !== 1 || !Array.isArray(payload.items)) {
    throw new Error('That file is not an AR Menu export.')
  }
  for (const entry of payload.items) {
    await saveItem(entry.item, {
      glb: entry.glb ? await dataUrlToBlob(entry.glb) : null,
      usdz: entry.usdz ? await dataUrlToBlob(entry.usdz) : null,
      thumb: entry.thumb ? await dataUrlToBlob(entry.thumb) : null,
    })
  }
  return payload.items.length
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function dataUrlToBlob(dataUrl) {
  return fetch(dataUrl).then((response) => response.blob())
}
