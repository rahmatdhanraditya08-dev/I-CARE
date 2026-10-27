import type { Sample } from './domain'

export interface EventRecord {
  id?: number
  at: number
  type: string
  message: string
}

export interface SessionRecord {
  id?: number
  name: string
  deviceId: string
  source: 'demo' | 'mqtt'
  startedAt: number
  endedAt: number | null
  samples: Sample[]
}

const DB_NAME = 'icare-research-dashboard'
const DB_VERSION = 1

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('events')) {
        const events = db.createObjectStore('events', { keyPath: 'id', autoIncrement: true })
        events.createIndex('at', 'at')
      }
      if (!db.objectStoreNames.contains('sessions')) {
        const sessions = db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true })
        sessions.createIndex('startedAt', 'startedAt')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function transact<T>(storeName: string, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = operation(db.transaction(storeName, 'readwrite').objectStore(storeName))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export const saveEvent = (event: EventRecord) => transact<IDBValidKey>('events', (store) => store.add(event))
export const listEvents = () => transact<EventRecord[]>('events', (store) => store.getAll())
export const saveSession = (session: SessionRecord) => transact<IDBValidKey>('sessions', (store) => store.add(session))
export const updateSession = (session: SessionRecord) => transact<IDBValidKey>('sessions', (store) => store.put(session))
export const listSessions = () => transact<SessionRecord[]>('sessions', (store) => store.getAll())

export function downloadFile(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function samplesToCsv(samples: Sample[]): string {
  const keys = [...new Set(samples.flatMap(({ telemetry }) => Object.keys(telemetry)))]
  return ['timestamp,' + keys.join(','), ...samples.map(({ receivedAt, telemetry }) =>
    [new Date(receivedAt).toISOString(), ...keys.map((key) => JSON.stringify(telemetry[key] ?? ''))].join(','),
  )].join('\n')
}
