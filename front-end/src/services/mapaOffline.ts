const DATABASE_NAME = 'buds-offline-map-v1'
const DATABASE_VERSION = 1
const TILE_STORE = 'tiles'
const REGION_STORE = 'regions'

export const OFFLINE_MAP_LIMIT_BYTES = 750 * 1024 * 1024
const OPEN_FREE_MAP_TILEJSON = 'https://tiles.openfreemap.org/planet'

export interface OfflineMapRegion {
  id: string
  name: string
  latitude: number
  longitude: number
  radius_km: number
  min_zoom: number
  max_zoom: number
  tile_keys: string[]
  bytes: number
  created_at: string
}

export interface OfflineMapStatus {
  supported: boolean
  used_bytes: number
  limit_bytes: number
  tile_count: number
  regions: OfflineMapRegion[]
}

interface CachedTile {
  key: string
  data: ArrayBuffer
  bytes: number
  created_at: string
}

let databasePromise: Promise<IDBDatabase> | null = null
let onlineTemplatePromise: Promise<string> | null = null

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Falha no armazenamento do mapa.'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Falha ao salvar o mapa offline.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Gravação do mapa offline interrompida.'))
  })
}

function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in window)) return Promise.reject(new Error('Mapas offline não são suportados neste dispositivo.'))
  if (databasePromise) return databasePromise
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(TILE_STORE)) {
        database.createObjectStore(TILE_STORE, { keyPath: 'key' })
      }
      if (!database.objectStoreNames.contains(REGION_STORE)) {
        database.createObjectStore(REGION_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Não foi possível abrir o cache de mapas.'))
  })
  return databasePromise
}

async function allRecords<T>(storeName: string): Promise<T[]> {
  const database = await openDatabase()
  return requestResult(database.transaction(storeName, 'readonly').objectStore(storeName).getAll()) as Promise<T[]>
}

async function cachedTile(key: string): Promise<CachedTile | undefined> {
  const database = await openDatabase()
  return requestResult(database.transaction(TILE_STORE, 'readonly').objectStore(TILE_STORE).get(key))
}

async function saveTile(tile: CachedTile): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(TILE_STORE, 'readwrite')
  transaction.objectStore(TILE_STORE).put(tile)
  await transactionDone(transaction)
}

async function saveRegion(region: OfflineMapRegion): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction(REGION_STORE, 'readwrite')
  transaction.objectStore(REGION_STORE).put(region)
  await transactionDone(transaction)
}

async function tileTemplate(): Promise<string> {
  if (!onlineTemplatePromise) {
    onlineTemplatePromise = fetch(OPEN_FREE_MAP_TILEJSON, { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('Servidor de mapas indisponível.')
        const tileJson = await response.json() as { tiles?: string[] }
        const template = tileJson.tiles?.[0]
        if (!template) throw new Error('Fonte vetorial do mapa indisponível.')
        return template
      })
      .catch(error => {
        onlineTemplatePromise = null
        throw error
      })
  }
  return onlineTemplatePromise
}

function tileUrl(template: string, z: number, x: number, y: number) {
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
}

function longitudeTile(longitude: number, zoom: number) {
  return Math.floor(((longitude + 180) / 360) * (2 ** zoom))
}

function latitudeTile(latitude: number, zoom: number) {
  const radians = latitude * Math.PI / 180
  return Math.floor((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * (2 ** zoom))
}

function regionTiles(latitude: number, longitude: number, radiusKm: number, minZoom: number, maxZoom: number) {
  const latitudeDelta = radiusKm / 111.32
  const longitudeDelta = radiusKm / Math.max(20, 111.32 * Math.cos(latitude * Math.PI / 180))
  const south = Math.max(-85, latitude - latitudeDelta)
  const north = Math.min(85, latitude + latitudeDelta)
  const west = Math.max(-180, longitude - longitudeDelta)
  const east = Math.min(180, longitude + longitudeDelta)
  const tiles: Array<{ key: string; z: number; x: number; y: number }> = []

  for (let z = minZoom; z <= maxZoom; z += 1) {
    const maxIndex = (2 ** z) - 1
    const minX = Math.max(0, longitudeTile(west, z))
    const maxX = Math.min(maxIndex, longitudeTile(east, z))
    const minY = Math.max(0, latitudeTile(north, z))
    const maxY = Math.min(maxIndex, latitudeTile(south, z))
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        tiles.push({ key: `${z}/${x}/${y}`, z, x, y })
      }
    }
  }
  return tiles
}

export async function getOfflineMapStatus(): Promise<OfflineMapStatus> {
  if (!('indexedDB' in window)) {
    return { supported: false, used_bytes: 0, limit_bytes: OFFLINE_MAP_LIMIT_BYTES, tile_count: 0, regions: [] }
  }
  const [tiles, regions] = await Promise.all([
    allRecords<CachedTile>(TILE_STORE),
    allRecords<OfflineMapRegion>(REGION_STORE),
  ])
  return {
    supported: true,
    used_bytes: tiles.reduce((total, tile) => total + tile.bytes, 0),
    limit_bytes: OFFLINE_MAP_LIMIT_BYTES,
    tile_count: tiles.length,
    regions: regions.sort((a, b) => b.created_at.localeCompare(a.created_at)),
  }
}

export async function getMapVectorTile(z: number, x: number, y: number): Promise<ArrayBuffer> {
  const key = `${z}/${x}/${y}`
  const local = await cachedTile(key).catch(() => undefined)
  if (local) return local.data
  const template = await tileTemplate()
  const response = await fetch(tileUrl(template, z, x, y))
  if (!response.ok) throw new Error(`Tile ${key} indisponível.`)
  return response.arrayBuffer()
}

export async function downloadOfflineMapRegion(options: {
  name: string
  latitude: number
  longitude: number
  radiusKm?: number
  minZoom?: number
  maxZoom?: number
  onProgress?: (completed: number, total: number) => void
}): Promise<OfflineMapRegion> {
  // Quando o navegador permite, pede armazenamento persistente para reduzir a
  // chance de o sistema limpar as áreas offline sob pressão de espaço.
  await navigator.storage?.persist?.().catch(() => false)
  const radiusKm = Math.max(3, Math.min(options.radiusKm ?? 15, 25))
  const minZoom = Math.max(6, options.minZoom ?? 8)
  const maxZoom = Math.min(14, Math.max(minZoom, options.maxZoom ?? 14))
  const candidates = regionTiles(options.latitude, options.longitude, radiusKm, minZoom, maxZoom)
  const template = await tileTemplate()
  const before = await getOfflineMapStatus()
  let usedBytes = before.used_bytes
  let completed = 0
  const keys: string[] = []
  let regionBytes = 0

  // Poucas requisições simultâneas mantêm o download rápido sem aquecer o
  // iPhone nem disputar recursos com o modelo local.
  const queue = [...candidates]
  const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
    while (queue.length) {
      const tile = queue.shift()
      if (!tile) return
      const existing = await cachedTile(tile.key)
      if (existing) {
        keys.push(tile.key)
        regionBytes += existing.bytes
        completed += 1
        options.onProgress?.(completed, candidates.length)
        continue
      }
      const response = await fetch(tileUrl(template, tile.z, tile.x, tile.y))
      if (!response.ok) throw new Error(`Falha ao baixar parte do mapa (${tile.key}).`)
      const data = await response.arrayBuffer()
      if (usedBytes + data.byteLength > OFFLINE_MAP_LIMIT_BYTES) {
        throw new Error('O limite de 750 MB para mapas offline foi atingido.')
      }
      usedBytes += data.byteLength
      regionBytes += data.byteLength
      keys.push(tile.key)
      await saveTile({ key: tile.key, data, bytes: data.byteLength, created_at: new Date().toISOString() })
      completed += 1
      options.onProgress?.(completed, candidates.length)
    }
  })
  await Promise.all(workers)

  const region: OfflineMapRegion = {
    id: crypto.randomUUID(),
    name: options.name.trim() || 'Área offline',
    latitude: options.latitude,
    longitude: options.longitude,
    radius_km: radiusKm,
    min_zoom: minZoom,
    max_zoom: maxZoom,
    tile_keys: [...new Set(keys)],
    bytes: regionBytes,
    created_at: new Date().toISOString(),
  }
  await saveRegion(region)
  return region
}

export async function deleteOfflineMapRegion(regionId: string): Promise<void> {
  const database = await openDatabase()
  const regions = await allRecords<OfflineMapRegion>(REGION_STORE)
  const target = regions.find(region => region.id === regionId)
  if (!target) return
  const protectedKeys = new Set(
    regions.filter(region => region.id !== regionId).flatMap(region => region.tile_keys),
  )
  const transaction = database.transaction([TILE_STORE, REGION_STORE], 'readwrite')
  const tiles = transaction.objectStore(TILE_STORE)
  for (const key of target.tile_keys) {
    if (!protectedKeys.has(key)) tiles.delete(key)
  }
  transaction.objectStore(REGION_STORE).delete(regionId)
  await transactionDone(transaction)
}

export async function clearOfflineMaps(): Promise<void> {
  const database = await openDatabase()
  const transaction = database.transaction([TILE_STORE, REGION_STORE], 'readwrite')
  transaction.objectStore(TILE_STORE).clear()
  transaction.objectStore(REGION_STORE).clear()
  await transactionDone(transaction)
}
