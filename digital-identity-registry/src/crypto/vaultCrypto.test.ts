import { describe, expect, it } from 'vitest'
import {
  KDF_ITERATIONS,
  WrongPasswordError,
  InvalidEnvelopeError,
  decryptJson,
  deriveKey,
  encryptJson,
  fromBase64,
  makeKdfParams,
  parseEnvelope,
  toBase64,
} from './vaultCrypto'

// Тесты гоняются с уменьшенным числом итераций, чтобы не ждать минуты:
// сам вывод ключа одинаковый, отличается только стоимость.
const FAST_ITERATIONS = 1_000

function fastKdf() {
  const kdf = makeKdfParams()
  return { ...kdf, iterations: FAST_ITERATIONS }
}

const SECRET = {
  identities: [{ value: 'bank@example-very-secret.ru', label: 'Банковская' }],
  services: [{ name: 'Сбербанк', domain: 'sberbank.ru' }],
}

describe('base64', () => {
  it('гоняет байты туда и обратно без потерь', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(1000))
    expect(fromBase64(toBase64(bytes))).toEqual(bytes)
  })
})

describe('параметры KDF', () => {
  it('по умолчанию не меньше 600 000 итераций PBKDF2-SHA256', () => {
    const kdf = makeKdfParams()
    expect(kdf.iterations).toBeGreaterThanOrEqual(600_000)
    expect(kdf.iterations).toBe(KDF_ITERATIONS)
    expect(kdf.algo).toBe('PBKDF2')
    expect(kdf.hash).toBe('SHA-256')
  })

  it('каждая инициализация даёт новую соль', () => {
    expect(makeKdfParams().salt).not.toBe(makeKdfParams().salt)
  })
})

describe('шифрование и расшифровка', () => {
  it('расшифровывает то, что зашифровала, тем же паролем', async () => {
    const kdf = fastKdf()
    const key = await deriveKey('correct horse battery staple', kdf)
    const envelope = await encryptJson(SECRET, key, kdf)
    const { data } = await decryptJson<typeof SECRET>(envelope, 'correct horse battery staple')
    expect(data).toEqual(SECRET)
  })

  it('неверный пароль даёт WrongPasswordError, а не пустое хранилище', async () => {
    const kdf = fastKdf()
    const key = await deriveKey('правильный пароль', kdf)
    const envelope = await encryptJson(SECRET, key, kdf)
    await expect(decryptJson(envelope, 'неправильный пароль')).rejects.toBeInstanceOf(
      WrongPasswordError,
    )
  })

  it('подделанный шифротекст отвергается (GCM ловит подмену)', async () => {
    const kdf = fastKdf()
    const key = await deriveKey('пароль', kdf)
    const envelope = await encryptJson(SECRET, key, kdf)
    const bytes = fromBase64(envelope.ciphertext)
    bytes[5] ^= 0xff
    const tampered = { ...envelope, ciphertext: toBase64(bytes) }
    await expect(decryptJson(tampered, 'пароль')).rejects.toBeInstanceOf(WrongPasswordError)
  })

  it('в конверте не читается ни адрес, ни домен, ни имя сервиса', async () => {
    const kdf = fastKdf()
    const key = await deriveKey('пароль', kdf)
    const envelope = await encryptJson(SECRET, key, kdf)
    const serialized = JSON.stringify(envelope)
    expect(serialized).not.toContain('bank@')
    expect(serialized).not.toContain('sberbank')
    expect(serialized).not.toContain('Сбербанк')
    expect(serialized).not.toContain('Банковская')
  })

  it('каждый вызов шифрования берёт свежий IV', async () => {
    const kdf = fastKdf()
    const key = await deriveKey('пароль', kdf)
    const a = await encryptJson(SECRET, key, kdf)
    const b = await encryptJson(SECRET, key, kdf)
    expect(a.iv).not.toBe(b.iv)
    expect(a.ciphertext).not.toBe(b.ciphertext)
  })
})

describe('parseEnvelope: валидация импортируемого файла', () => {
  // Для парсинга нужен конверт с «настоящим» числом итераций:
  // всё, что ниже KDF_ITERATIONS_MIN, валидатор обязан отвергать.
  const validKdf = () => ({ ...makeKdfParams(), iterations: 100_000 })

  it('пропускает собственный экспорт', async () => {
    const kdf = validKdf()
    const key = await deriveKey('пароль', kdf)
    const envelope = await encryptJson(SECRET, key, kdf)
    expect(parseEnvelope(JSON.parse(JSON.stringify(envelope)))).toEqual(envelope)
  })

  it.each([
    ['не объект', 'просто строка'],
    ['чужой формат', { format: 'password-manager', version: 1 }],
    ['нет KDF', { format: 'identity-registry-vault', version: 1, iv: 'AA==', ciphertext: 'AA==' }],
  ])('отвергает мусор: %s', (_name, raw) => {
    expect(() => parseEnvelope(raw)).toThrow(InvalidEnvelopeError)
  })

  it('отвергает ослабленный и абсурдно тяжёлый KDF', async () => {
    const kdf = validKdf()
    const key = await deriveKey('пароль', kdf)
    const envelope = await encryptJson(SECRET, key, kdf)
    const weakened = { ...envelope, kdf: { ...envelope.kdf, iterations: 10 } }
    expect(() => parseEnvelope(weakened)).toThrow(InvalidEnvelopeError)
    const absurd = { ...envelope, kdf: { ...envelope.kdf, iterations: 100_000_000 } }
    expect(() => parseEnvelope(absurd)).toThrow(InvalidEnvelopeError)
  })
})
