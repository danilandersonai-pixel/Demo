/**
 * План миграции: сервисы в порядке переезда. Сначала фундамент — те, через
 * кого логинятся и восстанавливаются другие (почтовые провайдеры), потом
 * зависимые. Иначе на середине переезда можно отрезать себе восстановление.
 */
import { useMemo } from 'react'
import { migrationPlan } from '../domain/analysis'
import { useVault, useVaultData } from '../store/VaultContext'
import { Badge, Button, CriticalityDot, EmptyState, Mono } from './ui'

export function MigrationPage() {
  const vault = useVaultData()
  const { update } = useVault()
  const plan = useMemo(() => migrationPlan(vault), [vault])

  if (plan.length === 0) {
    return (
      <EmptyState title="Мигрировать нечего">
        План появится, когда в реестре будут сервисы.
      </EmptyState>
    )
  }

  const waves = [...new Set(plan.map((s) => s.wave))].sort((a, b) => a - b)

  const markMigrated = async (serviceId: string, name: string) => {
    await update((data) => ({
      ...data,
      events: [
        ...data.events,
        {
          id: crypto.randomUUID(),
          serviceId,
          type: 'migrated' as const,
          date: new Date().toISOString().slice(0, 10),
          note: `Отмечен мигрированным из плана («${name}»).`,
        },
      ],
    }))
  }

  return (
    <section aria-label="План миграции">
      <p className="mb-5 max-w-2xl text-sm leading-relaxed text-ink-dim">
        Порядок учитывает цепочки восстановления: сервис не попадает в волну раньше своего
        «фундамента». Внутри волны первыми идут те, от кого зависит больше всего остальных,
        затем — по критичности.
      </p>

      <ol className="space-y-6">
        {waves.map((wave) => (
          <li key={wave}>
            <h2 className="mb-2 font-display text-sm text-brass">
              Волна {wave + 1}
              {wave === 0 ? ' — фундамент' : ''}
            </h2>
            <ul className="space-y-2">
              {plan
                .filter((s) => s.wave === wave)
                .map((step) => (
                  <li
                    key={step.service.id}
                    className={`rounded-lg border border-panel-edge bg-panel p-3.5 sm:px-4 ${step.migrated ? 'opacity-60' : ''}`}
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <CriticalityDot criticality={step.service.criticality} />
                      <span className="font-medium">{step.service.name}</span>
                      <Mono className="text-ink-dim">{step.service.domain}</Mono>
                      {step.migrated ? <Badge tone="ok">мигрирован</Badge> : null}
                      {step.inCycle ? (
                        <Badge tone="danger">цикл восстановления — рвать руками</Badge>
                      ) : null}
                      {!step.migrated ? (
                        <Button
                          className="ml-auto px-2.5 py-1 text-xs"
                          onClick={() => markMigrated(step.service.id, step.service.name)}
                        >
                          Отметить мигрированным
                        </Button>
                      ) : null}
                    </div>
                    <p className="mt-1.5 text-xs text-ink-dim">
                      {step.dependents.length > 0
                        ? `Держит на себе: ${step.dependents.map((d) => d.name).join(', ')}. `
                        : ''}
                      {step.dependsOn.length > 0
                        ? `Зависит от: ${step.dependsOn.map((d) => d.name).join(', ')}.`
                        : step.dependents.length === 0
                          ? 'Ни от кого не зависит и никого не держит — можно в любой момент.'
                          : ''}
                    </p>
                  </li>
                ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  )
}
