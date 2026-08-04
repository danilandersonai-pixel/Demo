/**
 * Ревизия: что не пересматривалось больше года, где критичный сервис до сих
 * пор на SMS (или вовсе без 2FA), какие удаления запрошены, но не
 * подтверждены. Отметка «проверен» пишется в журнал одним нажатием.
 */
import { useMemo } from 'react'
import { audit } from '../domain/analysis'
import { useVault, useVaultData } from '../store/VaultContext'
import { TWO_FACTOR_LABELS } from '../types'
import { Badge, Button, CriticalityDot, Mono } from './ui'

export function AuditPage() {
  const vault = useVaultData()
  const { update } = useVault()
  const report = useMemo(() => audit(vault, new Date()), [vault])

  const markReviewed = async (serviceId: string) => {
    await update((data) => ({
      ...data,
      events: [
        ...data.events,
        {
          id: crypto.randomUUID(),
          serviceId,
          type: 'reviewed' as const,
          date: new Date().toISOString().slice(0, 10),
          note: 'Проверен в ходе ревизии.',
        },
      ],
    }))
  }

  const confirmDeleted = async (serviceId: string) => {
    await update((data) => ({
      ...data,
      services: data.services.map((s) =>
        s.id === serviceId ? { ...s, status: 'deleted' as const } : s,
      ),
    }))
  }

  const clean =
    report.stale.length === 0 &&
    report.weakTwoFactor.length === 0 &&
    report.unconfirmedDeletions.length === 0

  if (clean) {
    return (
      <p className="rounded-lg border border-panel-edge bg-panel p-6 text-sm text-ink-dim">
        Ревизия чиста: всё пересмотрено за последний год, критичные сервисы не сидят на SMS,
        зависших удалений нет.
      </p>
    )
  }

  return (
    <section aria-label="Ревизия" className="space-y-7">
      {report.weakTwoFactor.length > 0 ? (
        <div>
          <h2 className="mb-1 font-display text-sm text-brass">
            Критичные со слабой защитой — {report.weakTwoFactor.length}
          </h2>
          <p className="mb-2 text-xs text-ink-dim">
            SMS перехватывается подменой SIM; для критичных сервисов нужен TOTP или passkey.
          </p>
          <ul className="space-y-2">
            {report.weakTwoFactor.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-sm"
              >
                <CriticalityDot criticality={s.criticality} />
                <span className="font-medium">{s.name}</span>
                <Mono className="text-ink-dim">{s.domain}</Mono>
                <Badge tone="danger">{TWO_FACTOR_LABELS[s.twoFactor]}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {report.stale.length > 0 ? (
        <div>
          <h2 className="mb-1 font-display text-sm text-brass">
            Больше года без ревизии — {report.stale.length}
          </h2>
          <p className="mb-2 text-xs text-ink-dim">
            За год меняется всё: пароли утекают, сервисы продаются, условия переписываются.
          </p>
          <ul className="space-y-2">
            {report.stale.map(({ service, lastTouched }) => (
              <li
                key={service.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-panel-edge bg-panel px-3.5 py-2.5 text-sm"
              >
                <CriticalityDot criticality={service.criticality} />
                <span className="font-medium">{service.name}</span>
                <Mono className="text-ink-dim">{service.domain}</Mono>
                <span className="text-xs text-ink-dim">
                  последний раз: <Mono>{lastTouched.slice(0, 10)}</Mono>
                </span>
                <Button
                  className="ml-auto px-2.5 py-1 text-xs"
                  onClick={() => markReviewed(service.id)}
                >
                  Проверил только что
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {report.unconfirmedDeletions.length > 0 ? (
        <div>
          <h2 className="mb-1 font-display text-sm text-brass">
            Удаление запрошено, подтверждения нет — {report.unconfirmedDeletions.length}
          </h2>
          <p className="mb-2 text-xs text-ink-dim">
            «Мы удалим ваш аккаунт в течение 30 дней» — а проверял ли кто-нибудь?
          </p>
          <ul className="space-y-2">
            {report.unconfirmedDeletions.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-panel-edge bg-panel px-3.5 py-2.5 text-sm"
              >
                <CriticalityDot criticality={s.criticality} />
                <span className="font-medium">{s.name}</span>
                <Mono className="text-ink-dim">{s.domain}</Mono>
                <Button
                  className="ml-auto px-2.5 py-1 text-xs"
                  onClick={() => confirmDeleted(s.id)}
                >
                  Подтвердить: удалён
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
