/**
 * Настройки: экспорт и импорт зашифрованного бэкапа, смена мастер-пароля,
 * демо-данные и полное удаление хранилища. Экспорт — тот же конверт, что
 * лежит в IndexedDB: расшифровывается только мастер-паролем.
 */
import { useState, type FormEvent } from 'react'
import { demoVault } from '../domain/demo'
import { useVault } from '../store/VaultContext'
import { WrongPasswordError } from '../crypto/vaultCrypto'
import { Button, FormError, Labeled, Modal, TextInput } from './ui'
import { RestoreModal } from './LockScreen'

export function SettingsPage() {
  const { exportEnvelope, importVault, changePassword, update, wipe, lock } = useVault()
  const [message, setMessage] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [wipeOpen, setWipeOpen] = useState(false)

  const doExport = async () => {
    const envelope = await exportEnvelope()
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `identity-registry-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    setMessage(
      'Бэкап скачан. Он зашифрован текущим мастер-паролем; храните его на офлайн-носителе и не кладите в git и облака.',
    )
  }

  const loadDemo = async () => {
    if (
      !confirm(
        'Демо-данные полностью заменят текущее содержимое хранилища. Продолжить?',
      )
    )
      return
    await update(() => demoVault())
    setMessage('Демо-данные загружены — загляните на «Карту»: там подсвечены все классы проблем.')
  }

  return (
    <section aria-label="Настройки" className="max-w-xl space-y-7">
      {message ? (
        <p role="status" className="rounded-lg border border-brass/40 bg-brass/5 px-3.5 py-2.5 text-sm">
          {message}
        </p>
      ) : null}

      <div>
        <h2 className="mb-1 font-display text-sm text-brass">Бэкап</h2>
        <p className="mb-3 text-sm text-ink-dim">
          Один файл .json с шифротекстом и параметрами KDF. Открывается тем же мастер-паролем.
          Забытый пароль не восстановит никто — регулярный экспорт и есть ваша страховка.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={doExport}>
            Экспортировать бэкап
          </Button>
          <Button onClick={() => setImportOpen(true)}>Импортировать из файла…</Button>
        </div>
      </div>

      <div>
        <h2 className="mb-1 font-display text-sm text-brass">Мастер-пароль</h2>
        <p className="mb-3 text-sm text-ink-dim">
          Смена пароля перешифровывает хранилище с новой солью. Старые файлы бэкапов продолжают
          открываться старым паролем.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setPasswordOpen(true)}>Сменить мастер-пароль…</Button>
          <Button onClick={lock}>Заблокировать</Button>
        </div>
      </div>

      <div>
        <h2 className="mb-1 font-display text-sm text-brass">Демо-данные</h2>
        <p className="mb-3 text-sm text-ink-dim">
          Вымышленный набор личностей и сервисов, в котором нарочно есть каждая проблема,
          которую умеет подсвечивать карта — включая критичный сервис с восстановлением на
          мусорную почту.
        </p>
        <Button onClick={loadDemo}>Загрузить демо-данные (заменит текущие)</Button>
      </div>

      <div>
        <h2 className="mb-1 font-display text-sm text-danger">Опасная зона</h2>
        <p className="mb-3 text-sm text-ink-dim">
          Удаление стирает хранилище с этого устройства безвозвратно. Бэкапы, которые вы
          экспортировали, останутся у вас.
        </p>
        <Button variant="danger" onClick={() => setWipeOpen(true)}>
          Удалить хранилище…
        </Button>
      </div>

      <div className="rounded-lg border border-panel-edge bg-panel p-4 text-sm text-ink-dim">
        <h2 className="mb-2 font-display text-xs text-brass">Чего это приложение не делает никогда</h2>
        <ul className="list-inside list-disc space-y-1">
          <li>не хранит пароли и коды 2FA — для этого есть менеджер паролей;</li>
          <li>не делает ни одного сетевого запроса (CSP: connect-src 'none');</li>
          <li>не проверяет утечки и не ходит во внешние базы;</li>
          <li>не синхронизируется и не имеет облачного аккаунта.</li>
        </ul>
      </div>

      {importOpen ? (
        <RestoreModal
          onClose={() => setImportOpen(false)}
          onRestore={importVault}
          replaceWarning
        />
      ) : null}
      {passwordOpen ? (
        <ChangePasswordModal
          onClose={() => setPasswordOpen(false)}
          onChange={changePassword}
          onDone={() => setMessage('Пароль сменён, хранилище перешифровано. Сделайте свежий экспорт.')}
        />
      ) : null}
      {wipeOpen ? (
        <WipeModal
          onClose={() => setWipeOpen(false)}
          onWipe={wipe}
        />
      ) : null}
    </section>
  )
}

function ChangePasswordModal({
  onClose,
  onChange,
  onDone,
}: {
  onClose: () => void
  onChange: (current: string, next: string) => Promise<void>
  onDone: () => void
}) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (next.length < 12) {
      setError('Новый пароль короче 12 символов.')
      return
    }
    if (next !== repeat) {
      setError('Новые пароли не совпадают.')
      return
    }
    setBusy(true)
    try {
      await onChange(current, next)
      onDone()
      onClose()
    } catch (err) {
      setError(err instanceof WrongPasswordError ? 'Текущий пароль неверен.' : 'Не получилось сменить пароль.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Смена мастер-пароля" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Labeled label="Текущий пароль">
          <TextInput type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
        </Labeled>
        <Labeled label="Новый пароль">
          <TextInput type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Labeled>
        <Labeled label="Новый пароль ещё раз">
          <TextInput type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        </Labeled>
        <FormError>{error}</FormError>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Перешифровка…' : 'Сменить'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function WipeModal({ onClose, onWipe }: { onClose: () => void; onWipe: () => Promise<void> }) {
  const [confirmText, setConfirmText] = useState('')
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (confirmText !== 'УДАЛИТЬ') {
      setError('Введите слово УДАЛИТЬ заглавными буквами.')
      return
    }
    await onWipe()
  }

  return (
    <Modal title="Удалить хранилище" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-danger">
          Всё содержимое реестра будет стёрто с этого устройства. Восстановить можно будет только
          из файла бэкапа. Это действие нельзя отменить.
        </p>
        <Labeled label="Для подтверждения введите: УДАЛИТЬ">
          <TextInput value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoFocus />
        </Labeled>
        <FormError>{error}</FormError>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" variant="danger">
            Стереть безвозвратно
          </Button>
        </div>
      </form>
    </Modal>
  )
}
