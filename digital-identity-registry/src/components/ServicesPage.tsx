/**
 * CRUD сервисов: кому какой логин отдан, куда смотрит восстановление,
 * какие данные выданы. Самое важное поле — recoveryEmailId.
 */
import { useMemo, useState, type FormEvent } from 'react'
import { useVault, useVaultData } from '../store/VaultContext'
import {
  CRITICALITY_LABELS,
  DATA_KIND_LABELS,
  SERVICE_STATUS_LABELS,
  TWO_FACTOR_LABELS,
  type Criticality,
  type DataKind,
  type Service,
  type ServiceStatus,
  type TwoFactor,
} from '../types'
import {
  Badge,
  Button,
  CriticalityDot,
  EmptyState,
  FormError,
  Labeled,
  Modal,
  Mono,
  Select,
  TextArea,
  TextInput,
} from './ui'

export function ServicesPage() {
  const vault = useVaultData()
  const { update } = useVault()
  const [search, setSearch] = useState('')
  const [critFilter, setCritFilter] = useState<'all' | Criticality>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | ServiceStatus>('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [editing, setEditing] = useState<Service | 'new' | null>(null)

  const categories = useMemo(
    () => [...new Set(vault.services.map((s) => s.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')),
    [vault.services],
  )

  const identityById = (id?: string) => vault.identities.find((i) => i.id === id)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const critOrder = { critical: 0, normal: 1, disposable: 2 } as const
    return vault.services
      .filter((s) => critFilter === 'all' || s.criticality === critFilter)
      .filter((s) => statusFilter === 'all' || s.status === statusFilter)
      .filter((s) => categoryFilter === 'all' || s.category === categoryFilter)
      .filter(
        (s) =>
          !q ||
          s.name.toLowerCase().includes(q) ||
          s.domain.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q),
      )
      .sort(
        (a, b) =>
          critOrder[a.criticality] - critOrder[b.criticality] ||
          a.name.localeCompare(b.name, 'ru'),
      )
  }, [vault.services, search, critFilter, statusFilter, categoryFilter])

  const remove = async (service: Service) => {
    if (!confirm(`Удалить запись о «${service.name}»? Журнал его событий тоже будет удалён.`)) return
    await update((draft) => ({
      ...draft,
      services: draft.services.filter((s) => s.id !== service.id),
      events: draft.events.filter((e) => e.serviceId !== service.id),
    }))
  }

  return (
    <section aria-label="Сервисы">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-44 flex-1">
          <TextInput
            type="search"
            placeholder="Поиск по названию, домену, категории…"
            aria-label="Поиск сервисов"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          aria-label="Фильтр по критичности"
          className="w-auto"
          value={critFilter}
          onChange={(e) => setCritFilter(e.target.value as typeof critFilter)}
        >
          <option value="all">Любая критичность</option>
          {Object.entries(CRITICALITY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Фильтр по статусу"
          className="w-auto"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
        >
          <option value="all">Все статусы</option>
          {Object.entries(SERVICE_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        {categories.length > 0 ? (
          <Select
            aria-label="Фильтр по категории"
            className="w-auto"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="all">Все категории</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        ) : null}
        <Button
          variant="primary"
          onClick={() => setEditing('new')}
          disabled={vault.identities.filter((i) => i.kind === 'email').length === 0}
          title={
            vault.identities.some((i) => i.kind === 'email')
              ? undefined
              : 'Сначала добавьте хотя бы одну почту во вкладке «Личности»'
          }
        >
          + Сервис
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title={vault.services.length === 0 ? 'Сервисов пока нет' : 'Ничего не найдено'}>
          {vault.services.length === 0 ? (
            <>Каждая запись — ответ на вопрос «что я отдал этому сервису и как его верну».</>
          ) : null}
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {filtered.map((service) => {
            const email = identityById(service.emailId)
            const recovery = identityById(service.recoveryEmailId)
            return (
              <li
                key={service.id}
                className="rounded-lg border border-panel-edge bg-panel p-3.5 sm:px-4"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <CriticalityDot criticality={service.criticality} />
                  <span className="font-medium">{service.name}</span>
                  <Mono className="text-ink-dim">{service.domain}</Mono>
                  <Badge>{service.category || 'без категории'}</Badge>
                  <Badge
                    tone={
                      service.criticality === 'critical' && (service.twoFactor === 'sms' || service.twoFactor === 'none')
                        ? 'danger'
                        : 'neutral'
                    }
                  >
                    {TWO_FACTOR_LABELS[service.twoFactor]}
                  </Badge>
                  {service.status !== 'active' ? (
                    <Badge tone="neutral">{SERVICE_STATUS_LABELS[service.status]}</Badge>
                  ) : null}
                  <span className="ml-auto flex gap-1.5">
                    <Button className="px-2.5 py-1 text-xs" onClick={() => setEditing(service)}>
                      Изменить
                    </Button>
                    <Button
                      variant="danger"
                      className="px-2.5 py-1 text-xs"
                      onClick={() => remove(service)}
                    >
                      Удалить
                    </Button>
                  </span>
                </div>
                <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-ink-dim">
                  <span>
                    логин: <Mono>{email?.value ?? '—'}</Mono>
                  </span>
                  <span>
                    восстановление:{' '}
                    <Mono>{recovery ? recovery.value : email && service.recoveryEmailId === undefined ? 'не указано' : '—'}</Mono>
                  </span>
                  {service.dataGiven.length > 0 ? (
                    <span>отдано: {service.dataGiven.map((d) => DATA_KIND_LABELS[d]).join(', ').toLowerCase()}</span>
                  ) : null}
                </p>
                {service.notes ? (
                  <p className="mt-1 text-xs text-ink-dim/80 italic">{service.notes}</p>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      {editing ? (
        <ServiceForm service={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
    </section>
  )
}

type ServiceDraft = Omit<Service, 'id' | 'registeredAt'>

function ServiceForm({ service, onClose }: { service: Service | null; onClose: () => void }) {
  const vault = useVaultData()
  const { update } = useVault()
  const emails = vault.identities.filter((i) => i.kind === 'email')
  const phones = vault.identities.filter((i) => i.kind === 'phone')

  const [draft, setDraft] = useState<ServiceDraft>(
    service
      ? { ...service }
      : {
          name: '',
          domain: '',
          category: '',
          emailId: emails[0]?.id ?? '',
          phoneId: undefined,
          recoveryEmailId: undefined,
          recoveryPhoneId: undefined,
          dataGiven: [],
          twoFactor: 'none',
          criticality: 'normal',
          status: 'active',
          notes: '',
        },
  )
  const [error, setError] = useState('')

  const set = <K extends keyof ServiceDraft>(key: K, value: ServiceDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  const toggleData = (kind: DataKind) =>
    set(
      'dataGiven',
      draft.dataGiven.includes(kind)
        ? draft.dataGiven.filter((d) => d !== kind)
        : [...draft.dataGiven, kind],
    )

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const name = draft.name.trim()
    const domain = draft.domain.trim().toLowerCase()
    if (!name || !domain) {
      setError('Название и домен обязательны.')
      return
    }
    if (!draft.emailId) {
      setError('Выберите почту-логин: без неё связь не построить.')
      return
    }
    const cleaned: ServiceDraft = {
      ...draft,
      name,
      domain,
      category: draft.category.trim(),
      notes: draft.notes?.trim() || undefined,
      phoneId: draft.phoneId || undefined,
      recoveryEmailId: draft.recoveryEmailId || undefined,
      recoveryPhoneId: draft.recoveryPhoneId || undefined,
    }
    await update((data) => {
      if (service) {
        return {
          ...data,
          services: data.services.map((s) => (s.id === service.id ? { ...s, ...cleaned } : s)),
        }
      }
      return {
        ...data,
        services: [
          ...data.services,
          {
            id: crypto.randomUUID(),
            registeredAt: new Date().toISOString().slice(0, 10),
            ...cleaned,
          },
        ],
      }
    })
    onClose()
  }

  const identityOptions = (list: typeof emails, allowEmpty: string | null) => (
    <>
      {allowEmpty !== null ? <option value="">{allowEmpty}</option> : null}
      {list.map((i) => (
        <option key={i.id} value={i.id}>
          {i.label} — {i.value}
        </option>
      ))}
    </>
  )

  return (
    <Modal title={service ? 'Изменить сервис' : 'Новый сервис'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Labeled label="Название">
            <TextInput value={draft.name} onChange={(e) => set('name', e.target.value)} autoFocus />
          </Labeled>
          <Labeled label="Домен">
            <TextInput
              className="font-mono"
              placeholder="example.ru"
              value={draft.domain}
              onChange={(e) => set('domain', e.target.value)}
            />
          </Labeled>
          <Labeled label="Категория" hint="банк, госуслуги, доставка, соцсеть…">
            <TextInput value={draft.category} onChange={(e) => set('category', e.target.value)} />
          </Labeled>
          <Labeled label="Критичность">
            <Select
              value={draft.criticality}
              onChange={(e) => set('criticality', e.target.value as Criticality)}
            >
              {Object.entries(CRITICALITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Labeled>
        </div>

        <fieldset className="rounded-lg border border-panel-edge p-3">
          <legend className="px-1 text-xs text-ink-dim">Связи — то, ради чего реестр</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Labeled label="Почта-логин">
              <Select value={draft.emailId} onChange={(e) => set('emailId', e.target.value)}>
                {identityOptions(emails, emails.length ? null : 'нет почт')}
              </Select>
            </Labeled>
            <Labeled label="Телефон">
              <Select value={draft.phoneId ?? ''} onChange={(e) => set('phoneId', e.target.value || undefined)}>
                {identityOptions(phones, 'не привязан')}
              </Select>
            </Labeled>
            <Labeled label="Почта восстановления" hint="Именно эти цепочки решают, что рухнет первым.">
              <Select
                value={draft.recoveryEmailId ?? ''}
                onChange={(e) => set('recoveryEmailId', e.target.value || undefined)}
              >
                {identityOptions(emails, 'не указана')}
              </Select>
            </Labeled>
            <Labeled label="Телефон восстановления">
              <Select
                value={draft.recoveryPhoneId ?? ''}
                onChange={(e) => set('recoveryPhoneId', e.target.value || undefined)}
              >
                {identityOptions(phones, 'не указан')}
              </Select>
            </Labeled>
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <Labeled label="Двухфакторка">
            <Select
              value={draft.twoFactor}
              onChange={(e) => set('twoFactor', e.target.value as TwoFactor)}
            >
              {Object.entries(TWO_FACTOR_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Labeled>
          <Labeled label="Статус">
            <Select
              value={draft.status}
              onChange={(e) => set('status', e.target.value as ServiceStatus)}
            >
              {Object.entries(SERVICE_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Labeled>
        </div>

        <fieldset>
          <legend className="mb-1.5 text-sm text-ink-dim">Какие данные отданы</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {Object.entries(DATA_KIND_LABELS).map(([value, label]) => (
              <label key={value} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={draft.dataGiven.includes(value as DataKind)}
                  onChange={() => toggleData(value as DataKind)}
                  className="size-4 accent-brass"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <Labeled label="Заметки">
          <TextArea
            rows={2}
            value={draft.notes ?? ''}
            onChange={(e) => set('notes', e.target.value)}
          />
        </Labeled>

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
