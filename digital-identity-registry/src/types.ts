/**
 * Модель данных реестра — ровно по спецификации.
 * В схеме сознательно нет полей под пароли, PIN и секреты 2FA:
 * это инвариант проекта, а не упущение.
 */

export type IdentityKind = 'email' | 'phone'
export type IdentityStatus = 'active' | 'retired' | 'compromised'

export type Identity = {
  id: string
  label: string // «Банковская», «Публичная», «Мусорная»
  kind: IdentityKind
  value: string
  isAlias: boolean // адрес, выданный алиас-сервисом
  createdAt: string
  status: IdentityStatus
}

export type DataKind = 'fio' | 'address' | 'passport' | 'card' | 'geo' | 'biometry'
export type TwoFactor = 'none' | 'sms' | 'totp' | 'passkey'
export type Criticality = 'critical' | 'normal' | 'disposable'
export type ServiceStatus = 'active' | 'deletion-requested' | 'deleted'

export type Service = {
  id: string
  name: string
  domain: string
  category: string // банк, госуслуги, доставка, соцсеть…
  emailId: string // основной логин
  phoneId?: string
  recoveryEmailId?: string // куда уходит восстановление доступа
  recoveryPhoneId?: string
  registeredAt: string
  dataGiven: DataKind[]
  twoFactor: TwoFactor
  criticality: Criticality
  status: ServiceStatus
  notes?: string
}

export type EventType = 'spam' | 'leak-suspected' | 'breach-confirmed' | 'migrated' | 'reviewed'

export type RegistryEvent = {
  id: string
  serviceId?: string
  identityId?: string
  type: EventType
  date: string
  note?: string
}

export type VaultData = {
  version: 1
  identities: Identity[]
  services: Service[]
  events: RegistryEvent[]
}

export function emptyVault(): VaultData {
  return { version: 1, identities: [], services: [], events: [] }
}

/* Подписи для UI — весь контент на русском */

export const DATA_KIND_LABELS: Record<DataKind, string> = {
  fio: 'ФИО',
  address: 'Адрес',
  passport: 'Паспорт',
  card: 'Карта',
  geo: 'Геолокация',
  biometry: 'Биометрия',
}

export const TWO_FACTOR_LABELS: Record<TwoFactor, string> = {
  none: 'нет 2FA',
  sms: 'SMS',
  totp: 'TOTP',
  passkey: 'Passkey',
}

export const CRITICALITY_LABELS: Record<Criticality, string> = {
  critical: 'критичный',
  normal: 'обычный',
  disposable: 'одноразовый',
}

export const SERVICE_STATUS_LABELS: Record<ServiceStatus, string> = {
  active: 'активен',
  'deletion-requested': 'запрошено удаление',
  deleted: 'удалён',
}

export const IDENTITY_STATUS_LABELS: Record<IdentityStatus, string> = {
  active: 'активна',
  retired: 'выведена',
  compromised: 'скомпрометирована',
}

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  spam: 'спам',
  'leak-suspected': 'подозрение на утечку',
  'breach-confirmed': 'утечка подтверждена',
  migrated: 'мигрирован',
  reviewed: 'проверен',
}
