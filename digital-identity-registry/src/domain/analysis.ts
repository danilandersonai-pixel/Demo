/**
 * Доменная аналитика поверх расшифрованных данных. Всё — чистые функции:
 * их можно тестировать без браузера и без хранилища.
 *
 * Здесь живут три вещи, ради которых приложение затевалось:
 *  - findProblems: подсветка опасных связей для карты;
 *  - migrationPlan: порядок переезда с учётом цепочек восстановления;
 *  - audit: ревизия того, что закисло.
 */
import type { Identity, RegistryEvent, Service, VaultData } from '../types'

/** Сервисы, в которых личность засвечена как логин (почта или телефон). */
export function loginServicesOf(vault: VaultData, identityId: string): Service[] {
  return vault.services.filter(
    (s) => s.status !== 'deleted' && (s.emailId === identityId || s.phoneId === identityId),
  )
}

/** Сервисы, где личность указана каналом восстановления. */
export function recoveryServicesOf(vault: VaultData, identityId: string): Service[] {
  return vault.services.filter(
    (s) =>
      s.status !== 'deleted' &&
      (s.recoveryEmailId === identityId || s.recoveryPhoneId === identityId),
  )
}

/**
 * Выведенная «роль» личности. Явного поля критичности у личности нет —
 * роль определяется тем, как адрес реально используется:
 *  - compromised — статус выставлен руками, хуже уже некуда;
 *  - trash — «мусорный ящик»: выведена из оборота или на неё заведён
 *    хотя бы один одноразовый сервис;
 *  - public — адрес засвечен в двух и более некритичных сервисах;
 *  - clean — используется только критичными сервисами или не используется.
 */
export type IdentityRole = 'compromised' | 'trash' | 'public' | 'clean'

export function identityRole(vault: VaultData, identity: Identity): IdentityRole {
  if (identity.status === 'compromised') return 'compromised'
  const logins = loginServicesOf(vault, identity.id)
  if (identity.status === 'retired') return 'trash'
  if (logins.some((s) => s.criticality === 'disposable')) return 'trash'
  if (logins.filter((s) => s.criticality !== 'critical').length >= 2) return 'public'
  return 'clean'
}

export const IDENTITY_ROLE_LABELS: Record<IdentityRole, string> = {
  compromised: 'скомпрометирована',
  trash: 'мусорная',
  public: 'публичная',
  clean: 'чистая',
}

export type MapProblem = {
  kind:
    | 'critical-on-public-email' // критичный сервис живёт на публичной/мусорной почте
    | 'critical-recovery-on-trash' // восстановление критичного сервиса ведёт на мусорный ящик
    | 'recovery-self-loop' // восстановление замыкается на почту самого сервиса
    | 'compromised-in-use' // сервис держится за скомпрометированную личность
  serviceId: string
  identityId: string
  text: string
}

function identityById(vault: VaultData, id: string | undefined): Identity | undefined {
  return id ? vault.identities.find((i) => i.id === id) : undefined
}

/** Домен почтового адреса: 'user@mail.example.ru' → 'mail.example.ru'. */
function emailDomain(value: string): string | null {
  const at = value.lastIndexOf('@')
  return at === -1 ? null : value.slice(at + 1).toLowerCase()
}

/** Личность предоставлена этим сервисом? (адрес на домене сервиса) */
function isProvidedBy(identity: Identity, service: Service): boolean {
  if (identity.kind !== 'email' || !service.domain) return false
  const domain = emailDomain(identity.value)
  const provider = service.domain.toLowerCase()
  return domain !== null && (domain === provider || domain.endsWith('.' + provider))
}

/**
 * Два класса проблем из спецификации плюс два, которые из них прямо следуют.
 * Смотрим только на неудалённые сервисы.
 */
export function findProblems(vault: VaultData): MapProblem[] {
  const problems: MapProblem[] = []
  for (const service of vault.services) {
    if (service.status === 'deleted') continue

    // Скомпрометированная личность в любой роли — проблема для любого сервиса
    for (const id of [
      service.emailId,
      service.phoneId,
      service.recoveryEmailId,
      service.recoveryPhoneId,
    ]) {
      const identity = identityById(vault, id)
      if (identity && identity.status === 'compromised') {
        problems.push({
          kind: 'compromised-in-use',
          serviceId: service.id,
          identityId: identity.id,
          text: `«${service.name}» держится за скомпрометированную личность «${identity.label}» (${identity.value}).`,
        })
      }
    }

    if (service.criticality !== 'critical') continue

    // Класс 1: критичный сервис на публичной или мусорной почте
    const login = identityById(vault, service.emailId)
    if (login) {
      const role = identityRole(vault, login)
      if (role === 'public' || role === 'trash') {
        problems.push({
          kind: 'critical-on-public-email',
          serviceId: service.id,
          identityId: login.id,
          text: `Критичный «${service.name}» заведён на ${role === 'trash' ? 'мусорную' : 'публичную'} почту «${login.label}» (${login.value}).`,
        })
      }
    }

    // Класс 2: восстановление критичного сервиса ведёт на мусорный ящик
    const recovery = identityById(vault, service.recoveryEmailId)
    if (recovery && recovery.id !== service.emailId) {
      const role = identityRole(vault, recovery)
      if (role === 'trash' || role === 'compromised') {
        problems.push({
          kind: 'critical-recovery-on-trash',
          serviceId: service.id,
          identityId: recovery.id,
          text: `Восстановление критичного «${service.name}» уходит на ${role === 'compromised' ? 'скомпрометированную' : 'мусорную'} почту «${recovery.label}» (${recovery.value}).`,
        })
      }
    }

    // Замыкание: восстановление ведёт на адрес, который выдал сам сервис
    if (recovery && isProvidedBy(recovery, service)) {
      problems.push({
        kind: 'recovery-self-loop',
        serviceId: service.id,
        identityId: recovery.id,
        text: `Восстановление «${service.name}» замыкается на его же почту ${recovery.value}: потеря аккаунта закрывает и путь восстановления.`,
      })
    }
  }
  // compromised-in-use может продублировать critical-recovery-on-trash — убираем повторы пары сервис+личность,
  // оставляя более специфичную формулировку (она добавляется позже и выигрывает).
  const byPair = new Map<string, MapProblem>()
  for (const p of problems) byPair.set(`${p.serviceId}:${p.identityId}:${p.kind}`, p)
  return [...byPair.values()]
}

/**
 * План миграции. Сервис P — «фундамент» для сервиса S, если S логинится или
 * восстанавливается через адрес, выданный P (домен адреса принадлежит P).
 * Такие сервисы переезжают раньше зависимых, иначе на середине переезда
 * можно остаться без канала восстановления.
 */
export type MigrationStep = {
  service: Service
  wave: number // 0 — фундамент, дальше по нарастанию зависимости
  dependsOn: Service[] // через кого этот сервис восстанавливается/логинится
  dependents: Service[] // кто не переедет, пока не переедет этот
  inCycle: boolean // взаимные recovery — надо рвать руками
  migrated: boolean // уже есть событие «мигрирован»
}

export function migrationPlan(vault: VaultData): MigrationStep[] {
  const services = vault.services.filter((s) => s.status !== 'deleted')

  const providerOf = (identityId: string | undefined): Service | undefined => {
    const identity = identityById(vault, identityId)
    if (!identity) return undefined
    return services.find((s) => isProvidedBy(identity, s))
  }

  const deps = new Map<string, Set<string>>() // serviceId -> ids фундаментов
  for (const s of services) {
    const set = new Set<string>()
    for (const idRef of [s.emailId, s.recoveryEmailId]) {
      const provider = providerOf(idRef)
      if (provider && provider.id !== s.id) set.add(provider.id)
    }
    deps.set(s.id, set)
  }

  // Волна = длина самой длинной цепочки фундаментов под сервисом.
  // Циклы (взаимные recovery двух почт) не роняют обход: участник цикла
  // получает волну по уже посчитанной части и флаг inCycle.
  const wave = new Map<string, number>()
  const visiting = new Set<string>()

  const computeWave = (id: string): number => {
    const known = wave.get(id)
    if (known !== undefined) return known
    if (visiting.has(id)) return 0
    visiting.add(id)
    let w = 0
    for (const dep of deps.get(id) ?? []) {
      w = Math.max(w, computeWave(dep) + 1)
    }
    visiting.delete(id)
    wave.set(id, w)
    return w
  }
  services.forEach((s) => computeWave(s.id))

  // В цикле сервис, который через цепочку фундаментов дотягивается до себя.
  // Помечаются ВСЕ участники цикла, а не только узел, где обход замкнулся.
  const canReachSelf = (start: string): boolean => {
    const seen = new Set<string>()
    const stack = [...(deps.get(start) ?? [])]
    while (stack.length > 0) {
      const id = stack.pop()!
      if (id === start) return true
      if (seen.has(id)) continue
      seen.add(id)
      stack.push(...(deps.get(id) ?? []))
    }
    return false
  }
  const inCycle = new Set(services.filter((s) => canReachSelf(s.id)).map((s) => s.id))

  const migratedIds = new Set(
    vault.events.filter((e) => e.type === 'migrated' && e.serviceId).map((e) => e.serviceId),
  )

  const critOrder = { critical: 0, normal: 1, disposable: 2 } as const
  const byId = new Map(services.map((s) => [s.id, s]))

  return services
    .map<MigrationStep>((s) => ({
      service: s,
      wave: wave.get(s.id) ?? 0,
      dependsOn: [...(deps.get(s.id) ?? [])].map((id) => byId.get(id)!).filter(Boolean),
      dependents: services.filter((other) => deps.get(other.id)?.has(s.id)),
      inCycle: inCycle.has(s.id),
      migrated: migratedIds.has(s.id),
    }))
    .sort(
      (a, b) =>
        a.wave - b.wave ||
        b.dependents.length - a.dependents.length ||
        critOrder[a.service.criticality] - critOrder[b.service.criticality] ||
        a.service.name.localeCompare(b.service.name, 'ru'),
    )
}

/** Ревизия: что закисло и требует взгляда. */
export type AuditReport = {
  stale: { service: Service; lastTouched: string }[] // не пересматривались больше года
  weakTwoFactor: Service[] // критичные с SMS или вовсе без 2FA
  unconfirmedDeletions: Service[] // удаление запрошено, но не подтверждено
}

const YEAR_MS = 365 * 24 * 60 * 60 * 1000

export function audit(vault: VaultData, now: Date): AuditReport {
  const active = vault.services.filter((s) => s.status === 'active')

  const lastTouched = (s: Service): string => {
    const touches = vault.events
      .filter((e) => e.serviceId === s.id && (e.type === 'reviewed' || e.type === 'migrated'))
      .map((e) => e.date)
    return [s.registeredAt, ...touches].sort().at(-1) ?? s.registeredAt
  }

  return {
    stale: active
      .map((service) => ({ service, lastTouched: lastTouched(service) }))
      .filter(({ lastTouched: t }) => now.getTime() - new Date(t).getTime() > YEAR_MS)
      .sort((a, b) => a.lastTouched.localeCompare(b.lastTouched)),
    weakTwoFactor: active.filter(
      (s) => s.criticality === 'critical' && (s.twoFactor === 'sms' || s.twoFactor === 'none'),
    ),
    unconfirmedDeletions: vault.services.filter((s) => s.status === 'deletion-requested'),
  }
}

/**
 * Подозреваемые источники утечки: пришёл спам на личность — значит, адрес
 * утёк из одного из сервисов, куда он отдан как логин. Если сервис один,
 * подозрение практически прямое (особенно для алиасов вида имя+сервис@).
 */
export function leakSuspects(vault: VaultData, identityId: string): Service[] {
  return loginServicesOf(vault, identityId)
}

/** События, отсортированные от свежих к старым. */
export function sortedEvents(vault: VaultData): RegistryEvent[] {
  return [...vault.events].sort((a, b) => b.date.localeCompare(a.date))
}
