/**
 * Оболочка: экран мастер-пароля до разблокировки, вкладки после.
 * Единственное яркое место интерфейса — карта; всё остальное тихое.
 */
import { useState } from 'react'
import { AuditPage } from './components/AuditPage'
import { IdentitiesPage } from './components/IdentitiesPage'
import { JournalPage } from './components/JournalPage'
import { LockScreen } from './components/LockScreen'
import { MapPage } from './components/MapPage'
import { MigrationPage } from './components/MigrationPage'
import { ServicesPage } from './components/ServicesPage'
import { SettingsPage } from './components/SettingsPage'
import { Button } from './components/ui'
import { useVault } from './store/VaultContext'

const TABS = [
  { id: 'map', label: 'Карта', component: MapPage },
  { id: 'services', label: 'Сервисы', component: ServicesPage },
  { id: 'identities', label: 'Личности', component: IdentitiesPage },
  { id: 'migration', label: 'Миграция', component: MigrationPage },
  { id: 'journal', label: 'Журнал', component: JournalPage },
  { id: 'audit', label: 'Ревизия', component: AuditPage },
  { id: 'settings', label: 'Настройки', component: SettingsPage },
] as const

type TabId = (typeof TABS)[number]['id']

export default function App() {
  const { state, lock } = useVault()
  const [tab, setTab] = useState<TabId>('map')

  if (state.phase === 'loading') {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <p className="text-sm text-ink-dim">Открываю хранилище…</p>
      </main>
    )
  }

  if (state.phase === 'empty') return <LockScreen mode="create" />
  if (state.phase === 'locked') return <LockScreen mode="unlock" />

  const ActivePage = TABS.find((t) => t.id === tab)!.component

  return (
    <div className="mx-auto min-h-dvh w-full max-w-5xl px-4 pb-16">
      <header className="flex items-center justify-between gap-4 py-5">
        <h1 className="font-display text-sm text-ink sm:text-base">
          Реестр цифровых личностей
        </h1>
        <Button onClick={lock} className="px-3 py-1.5 text-xs">
          Заблокировать
        </Button>
      </header>

      <nav aria-label="Разделы" className="-mx-4 mb-6 overflow-x-auto px-4">
        <ul className="flex min-w-max gap-1 border-b border-panel-edge">
          {TABS.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? 'page' : undefined}
                className={`cursor-pointer rounded-t-md px-3.5 py-2 text-sm transition-colors ${
                  tab === t.id
                    ? 'border-b-2 border-brass text-brass'
                    : 'text-ink-dim hover:text-ink'
                }`}
              >
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <ActivePage />
    </div>
  )
}
