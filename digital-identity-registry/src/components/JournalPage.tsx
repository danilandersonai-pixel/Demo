/**
 * Журнал событий: спам на алиас, подозрения на утечку, ревизии, миграции.
 * Спам-событие на личность сразу показывает подозреваемые сервисы —
 * те, кому этот адрес отдан как логин.
 */
import { useMemo, useState, type FormEvent } from 'react'
import { leakSuspects, sortedEvents } from '../domain/analysis'
import { useVault, useVaultData } from '../store/VaultContext'
import { EVENT_TYPE_LABELS, type EventType, type RegistryEvent } from '../types'
import { Badge, Button, EmptyState, FormError, Labeled, Modal, Mono, Select, TextArea, TextInput } from './ui'

const EVENT_TONES: Record<EventType, 'neutral' | 'brass' | 'danger' | 'ok'> = {
  spam: 'brass',
  'leak-suspected': 'danger',
  'breach-confirmed': 'danger',
  migrated: 'ok',
  reviewed: 'ok',
}

export function JournalPage() {
  const vault = useVaultData()
  const { update } = useVault()
  const [adding, setAdding] = useState(false)
  const events = useMemo(() => sortedEvents(vault), [vault])

  const serviceName = (id?: string) => vault.services.find((s) => s.id === id)?.name
  const identityOf = (id?: string) => vault.identities.find((i) => i.id === id)

  const removeEvent = async (event: RegistryEvent) => {
    if (!confirm('Удалить запись из журнала?')) return
    await update((data) => ({ ...data, events: data.events.filter((e) => e.id !== event.id) }))
  }

  const markSuspect = async (serviceId: string, identityId: string) => {
    await update((data) => ({
      ...data,
      events: [
        ...data.events,
        {
          id: crypto.randomUUID(),
          serviceId,
          identityId,
          type: 'leak-suspected' as const,
          date: new Date().toISOString().slice(0, 10),
          note: 'Помечен как вероятный источник по спаму на адрес.',
        },
      ],
    }))
  }

  return (
    <section aria-label="Журнал событий">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-ink-dim">
          Здесь копится история: куда пришёл спам, что утекло, что проверено.
        </p>
        <Button variant="primary" onClick={() => setAdding(true)}>
          + Событие
        </Button>
      </div>

      {events.length === 0 ? (
        <EmptyState title="Журнал пуст">
          Первое событие обычно такое: «на алиас пришёл спам — значит, адрес кто-то слил».
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {events.map((event) => {
            const identity = identityOf(event.identityId)
            const suspects =
              event.type === 'spam' && event.identityId
                ? leakSuspects(vault, event.identityId)
                : []
            const alreadySuspected = new Set(
              vault.events
                .filter((e) => e.type === 'leak-suspected' && e.serviceId)
                .map((e) => e.serviceId),
            )
            return (
              <li key={event.id} className="rounded-lg border border-panel-edge bg-panel p-3.5 sm:px-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <Mono className="text-xs text-ink-dim">{event.date}</Mono>
                  <Badge tone={EVENT_TONES[event.type]}>{EVENT_TYPE_LABELS[event.type]}</Badge>
                  {serviceName(event.serviceId) ? (
                    <span className="text-sm font-medium">{serviceName(event.serviceId)}</span>
                  ) : null}
                  {identity ? <Mono className="text-sm text-brass">{identity.value}</Mono> : null}
                  <Button
                    variant="danger"
                    className="ml-auto px-2.5 py-1 text-xs"
                    onClick={() => removeEvent(event)}
                  >
                    Удалить
                  </Button>
                </div>
                {event.note ? <p className="mt-1.5 text-sm text-ink-dim">{event.note}</p> : null}
                {suspects.length > 0 ? (
                  <div className="mt-2 rounded-md border border-brass/30 bg-brass/5 px-3 py-2 text-sm">
                    <p className="text-ink-dim">
                      Адрес отдан как логин {suspects.length === 1 ? 'ровно одному сервису' : `${suspects.length} сервисам`} —{' '}
                      {suspects.length === 1
                        ? 'подозрение практически прямое:'
                        : 'источник утечки среди них:'}
                    </p>
                    <ul className="mt-1.5 flex flex-wrap gap-2">
                      {suspects.map((s) => (
                        <li key={s.id} className="flex items-center gap-1.5">
                          <span className="font-medium">{s.name}</span>
                          {alreadySuspected.has(s.id) ? (
                            <Badge tone="danger">уже помечен</Badge>
                          ) : (
                            <Button
                              className="px-2 py-0.5 text-xs"
                              onClick={() => markSuspect(s.id, event.identityId!)}
                            >
                              пометить источником
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      {adding ? <EventForm onClose={() => setAdding(false)} /> : null}
    </section>
  )
}

function EventForm({ onClose }: { onClose: () => void }) {
  const vault = useVaultData()
  const { update } = useVault()
  const [type, setType] = useState<EventType>('spam')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [serviceId, setServiceId] = useState('')
  const [identityId, setIdentityId] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!serviceId && !identityId) {
      setError('Привяжите событие хотя бы к сервису или личности.')
      return
    }
    await update((data) => ({
      ...data,
      events: [
        ...data.events,
        {
          id: crypto.randomUUID(),
          type,
          date,
          serviceId: serviceId || undefined,
          identityId: identityId || undefined,
          note: note.trim() || undefined,
        },
      ],
    }))
    onClose()
  }

  return (
    <Modal title="Новое событие" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Тип">
            <Select value={type} onChange={(e) => setType(e.target.value as EventType)}>
              {Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Labeled>
          <Labeled label="Дата">
            <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Labeled>
        </div>
        <Labeled label="Сервис">
          <Select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            <option value="">не привязан</option>
            {vault.services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Labeled>
        <Labeled label="Личность" hint="Для спама — адрес, на который он пришёл.">
          <Select value={identityId} onChange={(e) => setIdentityId(e.target.value)}>
            <option value="">не привязана</option>
            {vault.identities.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label} — {i.value}
              </option>
            ))}
          </Select>
        </Labeled>
        <Labeled label="Заметка">
          <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Labeled>
        <FormError>{error}</FormError>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" variant="primary">
            Записать
          </Button>
        </div>
      </form>
    </Modal>
  )
}
