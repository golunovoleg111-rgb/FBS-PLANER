import type { AppSnapshot, AuditEntry } from './types';

const DB = 'fbs-workspace-v3';
const STORE = 'state';
const KEY = 'current';

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadSnapshot(): Promise<AppSnapshot | null> {
  const db = await openDb();
  return new Promise<AppSnapshot | null>((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
    request.onsuccess = () => resolve((request.result as AppSnapshot | undefined) || null);
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

export async function saveSnapshot(snapshot: AppSnapshot) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(snapshot, KEY);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export function audit(action: string, details: string): AuditEntry {
  return { id: crypto.randomUUID(), at: new Date().toISOString(), action, details };
}

export function exportState(snapshot: AppSnapshot) {
  return new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
}

export async function importState(file: File): Promise<AppSnapshot> {
  const value = JSON.parse(await file.text()) as AppSnapshot;
  if (value.version !== 3 || !Array.isArray(value.requests) || !Array.isArray(value.boxes) || !Array.isArray(value.audit)) {
    throw new Error('Файл не является полным экспортом FBS Workspace v3.');
  }
  return value;
}
