/**
 * Криптослой хранилища: мастер-пароль → PBKDF2-SHA256 (600 000 итераций) →
 * AES-256-GCM. Наружу (в IndexedDB и в файл экспорта) уходит только конверт
 * EncryptedEnvelope — ни одного читаемого адреса, домена или имени сервиса.
 *
 * Восстановление пароля невозможно by design: ключ нигде не хранится и
 * выводится заново при каждой разблокировке.
 */

export const KDF_ITERATIONS = 600_000
// Пределы валидации импортируемых файлов: защищают от файла, который
// ослабляет KDF или подвешивает вкладку абсурдным числом итераций.
export const KDF_ITERATIONS_MIN = 100_000
export const KDF_ITERATIONS_MAX = 5_000_000

const SALT_BYTES = 16
const IV_BYTES = 12

export type KdfParams = {
  algo: 'PBKDF2'
  hash: 'SHA-256'
  iterations: number
  salt: string // base64
}

export type EncryptedEnvelope = {
  format: 'identity-registry-vault'
  version: 1
  kdf: KdfParams
  iv: string // base64
  ciphertext: string // base64
}

/** Неверный пароль или повреждённые данные — AES-GCM их не различает. */
export class WrongPasswordError extends Error {
  constructor() {
    super('Неверный мастер-пароль или повреждённый файл: данные не расшифрованы.')
    this.name = 'WrongPasswordError'
  }
}

export class InvalidEnvelopeError extends Error {
  constructor(detail: string) {
    super(`Файл не похож на бэкап реестра: ${detail}`)
    this.name = 'InvalidEnvelopeError'
  }
}

export function toBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export function makeKdfParams(): KdfParams {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  return { algo: 'PBKDF2', hash: 'SHA-256', iterations: KDF_ITERATIONS, salt: toBase64(salt) }
}

export async function deriveKey(password: string, kdf: KdfParams): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: kdf.hash,
      salt: fromBase64(kdf.salt).slice().buffer,
      iterations: kdf.iterations,
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false, // ключ неизвлекаемый: его нельзя экспортировать даже из DevTools
    ['encrypt', 'decrypt'],
  )
}

export async function encryptJson(
  data: unknown,
  key: CryptoKey,
  kdf: KdfParams,
): Promise<EncryptedEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const plaintext = new TextEncoder().encode(JSON.stringify(data))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.slice().buffer },
    key,
    plaintext.slice().buffer,
  )
  return {
    format: 'identity-registry-vault',
    version: 1,
    kdf,
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  }
}

export async function decryptWithKey<T>(envelope: EncryptedEnvelope, key: CryptoKey): Promise<T> {
  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(envelope.iv).slice().buffer },
      key,
      fromBase64(envelope.ciphertext).slice().buffer,
    )
  } catch {
    throw new WrongPasswordError()
  }
  return JSON.parse(new TextDecoder().decode(plaintext)) as T
}

/** Расшифровка паролем: выводит ключ по параметрам конверта и возвращает его вместе с данными. */
export async function decryptJson<T>(
  envelope: EncryptedEnvelope,
  password: string,
): Promise<{ data: T; key: CryptoKey }> {
  const key = await deriveKey(password, envelope.kdf)
  const data = await decryptWithKey<T>(envelope, key)
  return { data, key }
}

/** Строгая проверка структуры перед импортом чужого файла. */
export function parseEnvelope(raw: unknown): EncryptedEnvelope {
  if (typeof raw !== 'object' || raw === null) throw new InvalidEnvelopeError('не объект JSON')
  const e = raw as Record<string, unknown>
  if (e.format !== 'identity-registry-vault') throw new InvalidEnvelopeError('нет метки формата')
  if (e.version !== 1) throw new InvalidEnvelopeError(`неизвестная версия ${String(e.version)}`)
  if (typeof e.iv !== 'string' || typeof e.ciphertext !== 'string')
    throw new InvalidEnvelopeError('нет полей iv/ciphertext')
  const kdf = e.kdf as Record<string, unknown> | null
  if (typeof kdf !== 'object' || kdf === null) throw new InvalidEnvelopeError('нет параметров KDF')
  if (kdf.algo !== 'PBKDF2' || kdf.hash !== 'SHA-256')
    throw new InvalidEnvelopeError('неизвестный алгоритм KDF')
  if (
    typeof kdf.iterations !== 'number' ||
    !Number.isInteger(kdf.iterations) ||
    kdf.iterations < KDF_ITERATIONS_MIN ||
    kdf.iterations > KDF_ITERATIONS_MAX
  )
    throw new InvalidEnvelopeError('недопустимое число итераций KDF')
  if (typeof kdf.salt !== 'string') throw new InvalidEnvelopeError('нет соли KDF')
  for (const field of ['iv', 'ciphertext', 'salt'] as const) {
    const value = field === 'salt' ? kdf.salt : (e[field] as string)
    try {
      fromBase64(value)
    } catch {
      throw new InvalidEnvelopeError(`поле ${field} не в base64`)
    }
  }
  return {
    format: 'identity-registry-vault',
    version: 1,
    kdf: {
      algo: 'PBKDF2',
      hash: 'SHA-256',
      iterations: kdf.iterations,
      salt: kdf.salt,
    },
    iv: e.iv,
    ciphertext: e.ciphertext,
  }
}
