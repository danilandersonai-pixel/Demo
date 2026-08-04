/**
 * Карта зависимостей — сигнатурный элемент приложения. Метафора —
 * коммутационная панель: личности слева, сервисы справа, связи —
 * патч-кабели. Цвет кабеля кодирует критичность сервиса (это данные,
 * а не украшение), пунктир — канал восстановления.
 *
 * Подсвечиваются два класса проблем из спецификации: критичный сервис на
 * публичной почте и критичный сервис с восстановлением на мусорный ящик
 * (плюс скомпрометированные личности и замкнутые recovery).
 */
import { useMemo, useState } from 'react'
import { findProblems, identityRole, IDENTITY_ROLE_LABELS } from '../domain/analysis'
import { useVaultData } from '../store/VaultContext'
import type { Identity, Service } from '../types'
import { CRITICALITY_COLORS, EmptyState } from './ui'

const ROW_H = 64
const NODE_W = 230
const NODE_H = 46
const GAP = 260
const PAD = 16
const WIDTH = PAD * 2 + NODE_W * 2 + GAP

const PROBLEM_COLOR = 'var(--color-cable-critical)'

type Cable = {
  key: string
  identity: Identity
  service: Service
  kind: 'login' | 'phone' | 'recovery-email' | 'recovery-phone'
  problem: boolean
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…'
}

export function MapPage() {
  const vault = useVaultData()
  const [focusId, setFocusId] = useState<string | null>(null)

  const identities = useMemo(
    () =>
      [...vault.identities].sort(
        (a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label, 'ru'),
      ),
    [vault.identities],
  )
  const services = useMemo(() => {
    const critOrder = { critical: 0, normal: 1, disposable: 2 } as const
    return vault.services
      .filter((s) => s.status !== 'deleted')
      .sort(
        (a, b) =>
          critOrder[a.criticality] - critOrder[b.criticality] ||
          a.name.localeCompare(b.name, 'ru'),
      )
  }, [vault.services])

  const problems = useMemo(() => findProblems(vault), [vault])
  const problemPairs = useMemo(
    () => new Set(problems.map((p) => `${p.serviceId}:${p.identityId}`)),
    [problems],
  )
  const problemNodeIds = useMemo(
    () => new Set(problems.flatMap((p) => [p.serviceId, p.identityId])),
    [problems],
  )

  const yOfIdentity = new Map(identities.map((i, idx) => [i.id, PAD + idx * ROW_H + NODE_H / 2]))
  const yOfService = new Map(services.map((s, idx) => [s.id, PAD + idx * ROW_H + NODE_H / 2]))

  const cables = useMemo(() => {
    const list: Cable[] = []
    const push = (
      service: Service,
      identityId: string | undefined,
      kind: Cable['kind'],
    ) => {
      if (!identityId) return
      const identity = vault.identities.find((i) => i.id === identityId)
      if (!identity) return
      list.push({
        key: `${service.id}:${identityId}:${kind}`,
        identity,
        service,
        kind,
        problem: problemPairs.has(`${service.id}:${identityId}`),
      })
    }
    for (const s of services) {
      push(s, s.emailId, 'login')
      push(s, s.phoneId, 'phone')
      if (s.recoveryEmailId && s.recoveryEmailId !== s.emailId)
        push(s, s.recoveryEmailId, 'recovery-email')
      if (s.recoveryPhoneId && s.recoveryPhoneId !== s.phoneId)
        push(s, s.recoveryPhoneId, 'recovery-phone')
    }
    return list
  }, [services, vault.identities, problemPairs])

  if (identities.length === 0 || services.length === 0) {
    return (
      <EmptyState title="Карте пока нечего показывать">
        Добавьте хотя бы одну личность и один сервис — или загрузите демо-данные в «Настройках»,
        чтобы посмотреть, как выглядит подсветка проблем.
      </EmptyState>
    )
  }

  const height = PAD * 2 + Math.max(identities.length, services.length) * ROW_H
  const leftJackX = PAD + NODE_W
  const rightJackX = PAD + NODE_W + GAP

  const connectedTo = (nodeId: string) => {
    const set = new Set<string>([nodeId])
    for (const c of cables) {
      if (c.identity.id === nodeId) set.add(c.service.id)
      if (c.service.id === nodeId) set.add(c.identity.id)
    }
    return set
  }
  const visible = focusId ? connectedTo(focusId) : null

  const cableOffset = { login: -6, phone: 8, 'recovery-email': 0, 'recovery-phone': 12 }

  return (
    <section aria-label="Карта зависимостей">
      <p className="mb-3 text-sm text-ink-dim">
        Сплошной кабель — логин, пунктирный — восстановление доступа. Цвет — критичность сервиса.
        Щёлкните по гнезду, чтобы проследить его связи; повторный щелчок сбрасывает выбор.
      </p>

      <div className="overflow-x-auto rounded-xl border border-panel-edge bg-panel shadow-inner">
        <svg
          viewBox={`0 0 ${WIDTH} ${height}`}
          width={WIDTH}
          height={height}
          className="block min-w-full"
          role="img"
          aria-label={`Карта: ${identities.length} личностей, ${services.length} сервисов, проблемных связей: ${problems.length}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) setFocusId(null)
          }}
        >
          {/* Кабели */}
          <g>
            {cables.map((c) => {
              const y1 = (yOfIdentity.get(c.identity.id) ?? 0) + cableOffset[c.kind]
              const y2 = (yOfService.get(c.service.id) ?? 0) + cableOffset[c.kind]
              const midX = (leftJackX + rightJackX) / 2
              const d = `M ${leftJackX} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${rightJackX} ${y2}`
              const dimmed =
                visible && !(visible.has(c.identity.id) && visible.has(c.service.id))
              const color = CRITICALITY_COLORS[c.service.criticality]
              const dashed = c.kind === 'recovery-email' || c.kind === 'recovery-phone'
              const thin = c.kind === 'phone' || c.kind === 'recovery-phone'
              return (
                <g key={c.key} opacity={dimmed ? 0.1 : 1}>
                  {c.problem && !dimmed ? (
                    <path
                      d={d}
                      fill="none"
                      stroke={PROBLEM_COLOR}
                      strokeWidth={7}
                      strokeOpacity={0.3}
                      className="cable-problem"
                    />
                  ) : null}
                  <path
                    d={d}
                    fill="none"
                    stroke={color}
                    strokeWidth={thin ? 1.4 : 2.4}
                    strokeDasharray={dashed ? '6 5' : undefined}
                    strokeLinecap="round"
                  />
                </g>
              )
            })}
          </g>

          {/* Гнёзда личностей (слева) */}
          {identities.map((identity) => {
            const y = yOfIdentity.get(identity.id)! - NODE_H / 2
            const role = identityRole(vault, identity)
            const alarmed = problemNodeIds.has(identity.id)
            const dimmed = visible && !visible.has(identity.id)
            return (
              <g
                key={identity.id}
                opacity={dimmed ? 0.25 : 1}
                tabIndex={0}
                role="button"
                aria-label={`${identity.label}, ${identity.value}, роль: ${IDENTITY_ROLE_LABELS[role]}${alarmed ? ', есть проблемные связи' : ''}`}
                onClick={() => setFocusId((cur) => (cur === identity.id ? null : identity.id))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setFocusId((cur) => (cur === identity.id ? null : identity.id))
                  }
                }}
                className="cursor-pointer"
              >
                <rect
                  x={PAD}
                  y={y}
                  width={NODE_W}
                  height={NODE_H}
                  rx={8}
                  fill="var(--color-panel-raised)"
                  stroke={
                    focusId === identity.id
                      ? 'var(--color-brass)'
                      : alarmed
                        ? PROBLEM_COLOR
                        : 'var(--color-panel-edge)'
                  }
                  strokeWidth={focusId === identity.id || alarmed ? 1.8 : 1}
                />
                <text
                  x={PAD + 12}
                  y={y + 19}
                  fill="var(--color-ink)"
                  fontSize={12}
                  fontFamily="var(--font-sans)"
                >
                  {truncate(identity.label, 22)}
                  {identity.isAlias ? ' ⎘' : ''}
                </text>
                <text
                  x={PAD + 12}
                  y={y + 35}
                  fill={alarmed ? PROBLEM_COLOR : 'var(--color-ink-dim)'}
                  fontSize={10.5}
                  fontFamily="var(--font-mono)"
                >
                  {truncate(identity.value, 26)}
                </text>
                {/* латунное гнездо */}
                <circle cx={leftJackX} cy={y + NODE_H / 2} r={6} fill="var(--color-brass)" />
                <circle cx={leftJackX} cy={y + NODE_H / 2} r={2.6} fill="var(--color-panel)" />
              </g>
            )
          })}

          {/* Гнёзда сервисов (справа) */}
          {services.map((service) => {
            const y = yOfService.get(service.id)! - NODE_H / 2
            const alarmed = problemNodeIds.has(service.id)
            const dimmed = visible && !visible.has(service.id)
            return (
              <g
                key={service.id}
                opacity={dimmed ? 0.25 : 1}
                tabIndex={0}
                role="button"
                aria-label={`${service.name}, ${service.domain}${alarmed ? ', есть проблемы' : ''}`}
                onClick={() => setFocusId((cur) => (cur === service.id ? null : service.id))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setFocusId((cur) => (cur === service.id ? null : service.id))
                  }
                }}
                className="cursor-pointer"
              >
                <rect
                  x={rightJackX}
                  y={y}
                  width={NODE_W}
                  height={NODE_H}
                  rx={8}
                  fill="var(--color-panel-raised)"
                  stroke={
                    focusId === service.id
                      ? 'var(--color-brass)'
                      : alarmed
                        ? PROBLEM_COLOR
                        : 'var(--color-panel-edge)'
                  }
                  strokeWidth={focusId === service.id || alarmed ? 1.8 : 1}
                />
                <circle cx={rightJackX} cy={y + NODE_H / 2} r={6} fill="var(--color-brass)" />
                <circle cx={rightJackX} cy={y + NODE_H / 2} r={2.6} fill="var(--color-panel)" />
                <circle
                  cx={rightJackX + 20}
                  cy={y + NODE_H / 2}
                  r={4}
                  fill={CRITICALITY_COLORS[service.criticality]}
                />
                <text
                  x={rightJackX + 32}
                  y={y + 19}
                  fill="var(--color-ink)"
                  fontSize={12}
                  fontFamily="var(--font-sans)"
                >
                  {truncate(service.name, 20)}
                  {alarmed ? ' ⚠' : ''}
                </text>
                <text
                  x={rightJackX + 32}
                  y={y + 35}
                  fill="var(--color-ink-dim)"
                  fontSize={10.5}
                  fontFamily="var(--font-mono)"
                >
                  {truncate(service.domain, 24)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      {/* Легенда */}
      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-ink-dim">
        {(
          [
            ['критичный', 'critical'],
            ['обычный', 'normal'],
            ['одноразовый', 'disposable'],
          ] as const
        ).map(([label, crit]) => (
          <div key={crit} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-0.5 w-6 rounded"
              style={{ backgroundColor: CRITICALITY_COLORS[crit] }}
            />
            <dd>{label}</dd>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block w-6 border-t-2 border-dashed border-ink-dim" />
          <dd>восстановление</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-1.5 w-6 rounded"
            style={{ backgroundColor: PROBLEM_COLOR, opacity: 0.4 }}
          />
          <dd>проблемная связь</dd>
        </div>
      </dl>

      {/* Список проблем — то же, что подсвечено, но словами */}
      <div className="mt-6">
        <h2 className="font-display text-sm text-brass">
          {problems.length === 0
            ? 'Опасных связей не найдено'
            : `Опасные связи — ${problems.length}`}
        </h2>
        {problems.length === 0 ? (
          <p className="mt-2 text-sm text-ink-dim">
            Критичные сервисы не висят на публичных почтах, восстановление не уходит на мусорные
            ящики. Так и держать.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {problems.map((p, idx) => (
              <li
                key={idx}
                className="rounded-lg border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-sm leading-relaxed"
              >
                {p.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
