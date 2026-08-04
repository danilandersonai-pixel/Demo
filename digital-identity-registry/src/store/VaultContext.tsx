/**
 * Состояние хранилища. Расшифрованные данные живут только в памяти вкладки;
 * каждое изменение тут же шифруется и кладётся в IndexedDB. Ключ — объект
 * CryptoKey (неизвлекаемый), сам пароль после вывода ключа нигде не хранится.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  decryptJson,
  deriveKey,
  encryptJson,
  makeKdfParams,
  type EncryptedEnvelope,
  type KdfParams,
} from '../crypto/vaultCrypto'
import { loadEnvelope, saveEnvelope, wipeStorage } from '../storage/db'
import { emptyVault, type VaultData } from '../types'

export type VaultPhase =
  | { phase: 'loading' }
  | { phase: 'empty' } // хранилище ещё не создано
  | { phase: 'locked' }
  | { phase: 'unlocked'; data: VaultData }

type VaultApi = {
  state: VaultPhase
  createVault(password: string): Promise<void>
  unlock(password: string): Promise<void>
  lock(): void
  /** Единственный путь изменения данных: мутация → шифрование → диск. */
  update(mutate: (draft: VaultData) => VaultData): Promise<void>
  /** Текущий конверт для экспорта в файл. */
  exportEnvelope(): Promise<EncryptedEnvelope>
  /** Замена хранилища содержимым бэкапа (файл уже расшифрован его паролем). */
  importVault(envelope: EncryptedEnvelope, password: string): Promise<void>
  changePassword(current: string, next: string): Promise<void>
  wipe(): Promise<void>
}

const VaultContext = createContext<VaultApi | null>(null)

export function VaultProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<VaultPhase>({ phase: 'loading' })
  const keyRef = useRef<CryptoKey | null>(null)
  const kdfRef = useRef<KdfParams | null>(null)
  // Авторитетная копия данных: setState асинхронен, а persist нужен здесь и сейчас
  const dataRef = useRef<VaultData | null>(null)
  // Сохранения сериализуются: следующее шифрование ждёт предыдущую запись
  const persistChain = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    let alive = true
    loadEnvelope().then(
      (envelope) => {
        if (alive) setState(envelope ? { phase: 'locked' } : { phase: 'empty' })
      },
      () => {
        if (alive) setState({ phase: 'empty' })
      },
    )
    return () => {
      alive = false
    }
  }, [])

  const persist = useCallback((data: VaultData) => {
    const key = keyRef.current
    const kdf = kdfRef.current
    if (!key || !kdf) return Promise.reject(new Error('Хранилище заблокировано'))
    const step = persistChain.current.then(async () => {
      const envelope = await encryptJson(data, key, kdf)
      await saveEnvelope(envelope)
    })
    // Ошибка записи не должна навсегда сломать цепочку
    persistChain.current = step.catch(() => undefined)
    return step
  }, [])

  const createVault = useCallback(
    async (password: string) => {
      const kdf = makeKdfParams()
      const key = await deriveKey(password, kdf)
      keyRef.current = key
      kdfRef.current = kdf
      const data = emptyVault()
      dataRef.current = data
      await persist(data)
      setState({ phase: 'unlocked', data })
    },
    [persist],
  )

  const unlock = useCallback(async (password: string) => {
    const envelope = await loadEnvelope()
    if (!envelope) throw new Error('Хранилище не найдено')
    const { data, key } = await decryptJson<VaultData>(envelope, password)
    keyRef.current = key
    kdfRef.current = envelope.kdf
    dataRef.current = data
    setState({ phase: 'unlocked', data })
  }, [])

  const lock = useCallback(() => {
    keyRef.current = null
    kdfRef.current = null
    dataRef.current = null
    setState({ phase: 'locked' })
  }, [])

  const update = useCallback(
    async (mutate: (draft: VaultData) => VaultData) => {
      const current = dataRef.current
      if (!current) throw new Error('Хранилище заблокировано')
      const next = mutate(current)
      dataRef.current = next
      setState({ phase: 'unlocked', data: next })
      await persist(next)
    },
    [persist],
  )

  const exportEnvelope = useCallback(async () => {
    const envelope = await loadEnvelope()
    if (!envelope) throw new Error('Хранилище пусто — экспортировать нечего')
    return envelope
  }, [])

  const importVault = useCallback(async (envelope: EncryptedEnvelope, password: string) => {
    // Пароль файла проверяется до того, как трогаем текущее хранилище
    const { data, key } = await decryptJson<VaultData>(envelope, password)
    await saveEnvelope(envelope)
    keyRef.current = key
    kdfRef.current = envelope.kdf
    dataRef.current = data
    setState({ phase: 'unlocked', data })
  }, [])

  const changePassword = useCallback(
    async (current: string, next: string) => {
      const envelope = await loadEnvelope()
      if (!envelope) throw new Error('Хранилище пусто')
      const { data } = await decryptJson<VaultData>(envelope, current)
      const kdf = makeKdfParams() // новая соль под новый пароль
      const key = await deriveKey(next, kdf)
      keyRef.current = key
      kdfRef.current = kdf
      dataRef.current = data
      await persist(data)
      setState({ phase: 'unlocked', data })
    },
    [persist],
  )

  const wipe = useCallback(async () => {
    await wipeStorage()
    keyRef.current = null
    kdfRef.current = null
    dataRef.current = null
    setState({ phase: 'empty' })
  }, [])

  const api = useMemo<VaultApi>(
    () => ({
      state,
      createVault,
      unlock,
      lock,
      update,
      exportEnvelope,
      importVault,
      changePassword,
      wipe,
    }),
    [state, createVault, unlock, lock, update, exportEnvelope, importVault, changePassword, wipe],
  )

  return <VaultContext.Provider value={api}>{children}</VaultContext.Provider>
}

export function useVault(): VaultApi {
  const ctx = useContext(VaultContext)
  if (!ctx) throw new Error('useVault вне VaultProvider')
  return ctx
}

/** Данные разблокированного хранилища; вызывать только под фазой unlocked. */
export function useVaultData(): VaultData {
  const { state } = useVault()
  if (state.phase !== 'unlocked') throw new Error('Хранилище заблокировано')
  return state.data
}
