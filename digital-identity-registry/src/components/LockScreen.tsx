/**
 * Вход: создание хранилища (с честным предупреждением о невосстановимости
 * пароля — до создания, как требует спецификация) и разблокировка.
 * Отсюда же доступно восстановление из файла бэкапа.
 */
import { useRef, useState, type FormEvent } from 'react'
import { parseEnvelope, WrongPasswordError } from '../crypto/vaultCrypto'
import { useVault } from '../store/VaultContext'
import { Button, FormError, Labeled, Modal, TextInput } from './ui'

const MIN_PASSWORD_LENGTH = 12

export function LockScreen({ mode }: { mode: 'create' | 'unlock' }) {
  const { createVault, unlock, importVault } = useVault()
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [understood, setUnderstood] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [restoreOpen, setRestoreOpen] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (mode === 'create') {
      if (password.length < MIN_PASSWORD_LENGTH) {
        setError(`Парольная фраза короче ${MIN_PASSWORD_LENGTH} символов. Лучше несколько слов: длина здесь важнее спецсимволов.`)
        return
      }
      if (password !== repeat) {
        setError('Пароли не совпадают.')
        return
      }
      if (!understood) {
        setError('Подтвердите, что понимаете: пароль восстановить невозможно.')
        return
      }
    }
    setBusy(true)
    try {
      if (mode === 'create') await createVault(password)
      else await unlock(password)
    } catch (err) {
      setError(
        err instanceof WrongPasswordError
          ? err.message
          : 'Не получилось открыть хранилище. Подробности в консоли.',
      )
      if (!(err instanceof WrongPasswordError)) console.error(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <header className="mb-8 text-center">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full border-2 border-brass">
          <div className="size-5 rounded-full bg-brass" aria-hidden />
        </div>
        <h1 className="font-display text-lg leading-relaxed text-ink">
          Реестр цифровых
          <br />
          личностей
        </h1>
        <p className="mt-3 text-sm text-ink-dim">
          Карта того, какому сервису отданы какая почта, номер и данные. Всё хранится только на
          этом устройстве, в зашифрованном виде.
        </p>
      </header>

      {mode === 'create' ? (
        <div
          className="mb-6 rounded-lg border border-brass/40 bg-brass/5 p-4 text-sm leading-relaxed"
          role="note"
        >
          <p className="font-medium text-brass">Мастер-пароль восстановить невозможно.</p>
          <p className="mt-2 text-ink-dim">
            Нет ни сброса, ни «секретных вопросов», ни поддержки — хранилище расшифровывается
            только этим паролем. Забыли пароль и не сделали экспорт — данные потеряны навсегда.
            Так задумано: иначе карту вашей цифровой жизни мог бы открыть кто-то ещё.
          </p>
        </div>
      ) : null}

      <form onSubmit={submit} className="space-y-4">
        <Labeled
          label={mode === 'create' ? 'Придумайте мастер-пароль' : 'Мастер-пароль'}
          hint={
            mode === 'create'
              ? 'Надёжнее всего длинная фраза из несвязанных слов.'
              : undefined
          }
        >
          <TextInput
            type="password"
            autoFocus
            autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Labeled>

        {mode === 'create' ? (
          <>
            <Labeled label="Повторите пароль">
              <TextInput
                type="password"
                autoComplete="new-password"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
              />
            </Labeled>
            <label className="flex items-start gap-2.5 text-sm text-ink-dim">
              <input
                type="checkbox"
                checked={understood}
                onChange={(e) => setUnderstood(e.target.checked)}
                className="mt-0.5 size-4 accent-[#b08d4f]"
              />
              Понимаю, что пароль не восстанавливается, и буду делать экспорт бэкапа.
            </label>
          </>
        ) : null}

        <FormError>{error}</FormError>

        <Button type="submit" variant="primary" disabled={busy} className="w-full py-2.5">
          {busy
            ? 'Вывод ключа… это намеренно небыстро'
            : mode === 'create'
              ? 'Создать хранилище'
              : 'Открыть'}
        </Button>
      </form>

      <div className="mt-6 text-center">
        <Button onClick={() => setRestoreOpen(true)} className="text-xs">
          Восстановить из файла бэкапа
        </Button>
      </div>

      {restoreOpen ? (
        <RestoreModal
          onClose={() => setRestoreOpen(false)}
          onRestore={importVault}
          replaceWarning={mode === 'unlock'}
        />
      ) : null}
    </main>
  )
}

export function RestoreModal({
  onClose,
  onRestore,
  replaceWarning,
}: {
  onClose: () => void
  onRestore: (envelope: ReturnType<typeof parseEnvelope>, password: string) => Promise<void>
  replaceWarning: boolean
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    const file = fileRef.current?.files?.[0]
    if (!file) {
      setError('Выберите файл бэкапа (.json).')
      return
    }
    setBusy(true)
    try {
      const text = await file.text()
      let raw: unknown
      try {
        raw = JSON.parse(text)
      } catch {
        throw new Error('Файл не является JSON.')
      }
      const envelope = parseEnvelope(raw)
      await onRestore(envelope, password)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не получилось восстановить бэкап.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Восстановление из бэкапа" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {replaceWarning ? (
          <p className="text-sm text-danger">
            Восстановление заменит текущее хранилище целиком. Если в нём есть несохранённое —
            сначала сделайте экспорт.
          </p>
        ) : null}
        <Labeled label="Файл бэкапа">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="block w-full text-sm text-ink-dim file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-panel-edge file:bg-panel-raised file:px-3 file:py-1.5 file:text-ink"
          />
        </Labeled>
        <Labeled label="Пароль этого бэкапа">
          <TextInput
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Labeled>
        <FormError>{error}</FormError>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} type="button">
            Отмена
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Расшифровка…' : 'Восстановить'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
