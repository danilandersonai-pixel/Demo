/**
 * CRUD личностей: почты и номера, алиасы, статусы. Роль («чистая»,
 * «публичная», «мусорная») не хранится, а выводится из фактических связей.
 */
import { useMemo, useState, type FormEvent } from 'react'
import {
  IDENTITY_ROLE_LABELS,
  identityRole,
  loginServicesOf,
  recoveryServicesOf,
} from '../domain/analysis'
import { useVault, useVaultData } from '../store/VaultContext'
import {
  IDENTITY_STATUS_LABELS,
  type Identity,
  type IdentityKind,
  type IdentityStatus,
} from '../types'
import { Badge, Button, EmptyState, FormError, Labeled, Modal, Mono, Select, TextInput } from './ui'

type Draft = {
  label: string
  kind: IdentityKind
  value: string
  isAlias: boolean
  status: IdentityStatus
}

const emptyDraft: Draft = { label: '', kind: 'email', value: '', isAlias: false, status: 'active' }

export function IdentitiesPage() {
  const vault = useVaultData()
  const { update } = useVault()
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | IdentityKind>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | IdentityStatus>('all')
  const [editing, setEditing] = useState<Identity | 'new' | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return vault.identities
      .filter((i) => kindFilter === 'all' || i.kind === kindFilter)
      .filter((i) => statusFilter === 'all' || i.status === statusFilter)
      .filter((i) => !q || i.label.toLowerCase().includes(q) || i.value.toLowerCase().includes(q))
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label, 'ru'))
  }, [vault.identities, search, kindFilter, statusFilter])

  const remove = async (identity: Identity) => {
    const logins = loginServicesOf(vault, identity.id)
    const recoveries = recoveryServicesOf(vault, identity.id)
    if (logins.length + recoveries.length > 0) {
      alert(
        `Нельзя удалить: личность используется в ${logins.length + recoveries.length} сервисах (${[...logins, ...recoveries]
          .map((s) => s.name)
          .slice(0, 5)
          .join(', ')}…). Сначала перенесите их на другой адрес.`,
      )
      return
    }
    if (!confirm(`Удалить «${identity.label}» (${identity.value})? Действие необратимо.`)) return
    await update((draft) => ({
      ...draft,
      identities: draft.identities.filter((i) => i.id !== identity.id),
      events: draft.events.filter((e) => e.identityId !== identity.id),
    }))
  }

  return (
    <section aria-label="Личности">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-44 flex-1">
          <TextInput
            type="search"
            placeholder="Поиск по подписи или адресу…"
            aria-label="Поиск личностей"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          aria-label="Фильтр по типу"
          className="w-auto"
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)}
        >
          <option value="all">Все типы</option>
          <option value="email">Почта</option>
          <option value="phone">Телефон</option>
        </Select>
        <Select
          aria-label="Фильтр по статусу"
          className="w-auto"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
        >
          <option value="all">Все статусы</option>
          {Object.entries(IDENTITY_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Button variant="primary" onClick={() => setEditing('new')}>
          + Личность
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title={vault.identities.length === 0 ? 'Личностей пока нет' : 'Ничего не найдено'}>
          {vault.identities.length === 0
            ? 'Начните с почт и номеров, которые вы реально выдаёте сервисам.'
            : null}
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {filtered.map((identity) => {
            const role = identityRole(vault, identity)
            const logins = loginServicesOf(vault, identity.id)
            const recoveries = recoveryServicesOf(vault, identity.id)
            return (
              <li
                key={identity.id}
                className="rounded-lg border border-panel-edge bg-panel p-3.5 sm:px-4"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span aria-hidden className="text-ink-dim">
                    {identity.kind === 'email' ? '@' : '№'}
                  </span>
                  <span className="font-medium">{identity.label}</span>
                  <Mono className="break-all text-brass">{identity.value}</Mono>
                  {identity.isAlias ? <Badge tone="brass">алиас</Badge> : null}
                  {identity.status !== 'active' ? (
                    <Badge tone={identity.status === 'compromised' ? 'danger' : 'neutral'}>
                      {IDENTITY_STATUS_LABELS[identity.status]}
                    </Badge>
                  ) : null}
                  {role !== 'clean' ? (
                    <Badge tone={role === 'compromised' ? 'danger' : 'neutral'}>
                      {IDENTITY_ROLE_LABELS[role]}
                    </Badge>
                  ) : null}
                  <span className="ml-auto flex gap-1.5">
                    <Button className="px-2.5 py-1 text-xs" onClick={() => setEditing(identity)}>
                      Изменить
                    </Button>
                    <Button
                      variant="danger"
                      className="px-2.5 py-1 text-xs"
                      onClick={() => remove(identity)}
                    >
                      Удалить
                    </Button>
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-ink-dim">
                  Логин в {logins.length} серв., восстановление для {recoveries.length}.
                </p>
              </li>
            )
          })}
        </ul>
      )}

      {editing ? (
        <IdentityForm identity={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
    </section>
  )
}

function IdentityForm({ identity, onClose }: { identity: Identity | null; onClose: () => void }) {
  const { update } = useVault()
  const [draft, setDraft] = useState<Draft>(
    identity
      ? {
          label: identity.label,
          kind: identity.kind,
          value: identity.value,
          isAlias: identity.isAlias,
          status: identity.status,
        }
      : emptyDraft,
  )
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const label = draft.label.trim()
    const value = draft.value.trim()
    if (!label || !value) {
      setError('Подпись и адрес обязательны.')
      return
    }
    if (draft.kind === 'email' && !value.includes('@')) {
      setError('Почта без @ выглядит подозрительно.')
      return
    }
    await update((data) => {
      if (identity) {
        return {
          ...data,
          identities: data.identities.map((i) =>
            i.id === identity.id ? { ...i, ...draft, label, value } : i,
          ),
        }
      }
      return {
        ...data,
        identities: [
          ...data.identities,
          {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString().slice(0, 10),
            ...draft,
            label,
            value,
          },
        ],
      }
    })
    onClose()
  }

  return (
    <Modal title={identity ? 'Изменить личность' : 'Новая личность'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Labeled label="Подпись" hint="Например: «Банковская», «Публичная», «Мусорная»">
          <TextInput
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            autoFocus
          />
        </Labeled>
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Тип">
            <Select
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value as IdentityKind })}
            >
              <option value="email">Почта</option>
              <option value="phone">Телефон</option>
            </Select>
          </Labeled>
          <Labeled label="Статус">
            <Select
              value={draft.status}
              onChange={(e) => setDraft({ ...draft, status: e.target.value as IdentityStatus })}
            >
              {Object.entries(IDENTITY_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Labeled>
        </div>
        <Labeled label={draft.kind === 'email' ? 'Адрес' : 'Номер'}>
          <TextInput
            className="font-mono"
            value={draft.value}
            onChange={(e) => setDraft({ ...draft, value: e.target.value })}
            placeholder={draft.kind === 'email' ? 'name@example.ru' : '+7 …'}
          />
        </Labeled>
        <label className="flex items-center gap-2.5 text-sm text-ink-dim">
          <input
            type="checkbox"
            checked={draft.isAlias}
            onChange={(e) => setDraft({ ...draft, isAlias: e.target.checked })}
            className="size-4 accent-[#b08d4f]"
          />
          Это алиас (адрес, выданный алиас-сервисом или «плюсовый»)
        </label>
        <FormError>{error}</FormError>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" variant="primary">
            Сохранить
          </Button>
        </div>
      </form>
    </Modal>
  )
}
