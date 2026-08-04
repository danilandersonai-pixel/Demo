/**
 * IndexedDB через Dexie. В базе ровно одна запись — шифрованный конверт
 * всего хранилища. Никаких таблиц с личностями и сервисами в открытом виде:
 * при ручном просмотре IndexedDB читаются только base64-байты.
 */
import Dexie, { type EntityTable } from 'dexie'
import type { EncryptedEnvelope } from '../crypto/vaultCrypto'

type VaultRow = {
  id: string // всегда 'vault' — запись одна
  envelope: EncryptedEnvelope
  updatedAt: string
}

const DB_NAME = 'identity-registry'
const ROW_ID = 'vault'

const db = new Dexie(DB_NAME) as Dexie & {
  vault: EntityTable<VaultRow, 'id'>
}

db.version(1).stores({
  vault: 'id', // индекс только по служебному id, содержимое не индексируется
})

export async function loadEnvelope(): Promise<EncryptedEnvelope | null> {
  const row = await db.vault.get(ROW_ID)
  return row ? row.envelope : null
}

export async function saveEnvelope(envelope: EncryptedEnvelope): Promise<void> {
  await db.vault.put({ id: ROW_ID, envelope, updatedAt: new Date().toISOString() })
}

/** Полное удаление хранилища с диска. Необратимо. */
export async function wipeStorage(): Promise<void> {
  await db.delete()
  await db.open()
}
