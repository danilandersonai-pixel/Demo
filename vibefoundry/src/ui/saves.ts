import type { SimSnapshot } from '../sim/sim';

/** IndexedDB save slots: 'auto' + 3 manual slots. Falls back to memory when IndexedDB is unavailable. */
const DB = 'vibefoundry';
const STORE = 'saves';
export const SLOTS = ['auto', 'slot1', 'slot2', 'slot3'] as const;
export type SlotId = (typeof SLOTS)[number];

export interface SaveMeta {
  slot: SlotId;
  savedAt: number;
  day: number;
  era: number;
  seed: number;
  playtime: number;
  label: string;
}

interface SaveRecord {
  meta: SaveMeta;
  data: SimSnapshot & { blueprints?: any[] };
}

const memory = new Map<string, SaveRecord>();

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveSlot(slot: SlotId, data: SaveRecord['data'], meta: Omit<SaveMeta, 'slot' | 'savedAt'>): Promise<void> {
  const rec: SaveRecord = { meta: { ...meta, slot, savedAt: Date.now() }, data };
  const db = await open();
  if (!db) {
    memory.set(slot, rec);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(rec, slot);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadSlot(slot: SlotId): Promise<SaveRecord | null> {
  const db = await open();
  if (!db) return memory.get(slot) ?? null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(slot);
    req.onsuccess = () => resolve((req.result as SaveRecord) ?? null);
    req.onerror = () => resolve(null);
  });
}

export async function listSlots(): Promise<SaveMeta[]> {
  const out: SaveMeta[] = [];
  for (const s of SLOTS) {
    const r = await loadSlot(s);
    if (r) out.push(r.meta);
  }
  return out;
}

export async function deleteSlot(slot: SlotId): Promise<void> {
  const db = await open();
  if (!db) {
    memory.delete(slot);
    return;
  }
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(slot);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export function exportFile(data: SaveRecord['data'], name: string): void {
  const blob = new Blob([JSON.stringify({ format: 'vibefoundry-save', version: data.version, data })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function importFile(): Promise<SaveRecord['data'] | null> {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json,.json';
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return resolve(null);
      try {
        const j = JSON.parse(await f.text());
        if (j.format !== 'vibefoundry-save' || !j.data) return resolve(null);
        resolve(j.data);
      } catch {
        resolve(null);
      }
    };
    inp.click();
  });
}
