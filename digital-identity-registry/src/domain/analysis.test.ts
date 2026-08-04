import { describe, expect, it } from 'vitest'
import type { Identity, Service, VaultData } from '../types'
import { audit, findProblems, identityRole, leakSuspects, migrationPlan } from './analysis'

let seq = 0
const nextId = () => `id-${++seq}`

function identity(over: Partial<Identity>): Identity {
  return {
    id: nextId(),
    label: 'Личность',
    kind: 'email',
    value: 'user@example.ru',
    isAlias: false,
    createdAt: '2024-01-01',
    status: 'active',
    ...over,
  }
}

function service(over: Partial<Service> & { emailId: string }): Service {
  return {
    id: nextId(),
    name: 'Сервис',
    domain: 'example.ru',
    category: 'прочее',
    registeredAt: '2024-01-01',
    dataGiven: [],
    twoFactor: 'totp',
    criticality: 'normal',
    status: 'active',
    ...over,
  }
}

function vault(identities: Identity[], services: Service[], events: VaultData['events'] = []): VaultData {
  return { version: 1, identities, services, events }
}

describe('identityRole', () => {
  it('почта с одноразовым сервисом — мусорная', () => {
    const trash = identity({ label: 'Мусорная', value: 'dump@mail.ru' })
    const v = vault([trash], [service({ emailId: trash.id, criticality: 'disposable' })])
    expect(identityRole(v, trash)).toBe('trash')
  })

  it('почта, засвеченная в двух обычных сервисах — публичная', () => {
    const pub = identity({ value: 'me@mail.ru' })
    const v = vault(
      [pub],
      [service({ emailId: pub.id }), service({ emailId: pub.id })],
    )
    expect(identityRole(v, pub)).toBe('public')
  })

  it('почта только под критичным сервисом — чистая', () => {
    const bank = identity({ value: 'bank@mail.ru' })
    const v = vault([bank], [service({ emailId: bank.id, criticality: 'critical' })])
    expect(identityRole(v, bank)).toBe('clean')
  })
})

describe('findProblems — тестовый кейс из DoD', () => {
  it('подсвечивает критичный сервис с recovery на мусорную почту', () => {
    const bankMail = identity({ label: 'Банковская', value: 'bank@post.ru' })
    const trashMail = identity({ label: 'Мусорная', value: 'dump@post.ru' })
    const shop = service({ emailId: trashMail.id, criticality: 'disposable', name: 'Купоны' })
    const bank = service({
      emailId: bankMail.id,
      recoveryEmailId: trashMail.id,
      criticality: 'critical',
      name: 'Банк',
    })
    const problems = findProblems(vault([bankMail, trashMail], [shop, bank]))
    const hit = problems.find(
      (p) => p.kind === 'critical-recovery-on-trash' && p.serviceId === bank.id,
    )
    expect(hit).toBeDefined()
    expect(hit!.identityId).toBe(trashMail.id)
  })

  it('подсвечивает критичный сервис на публичной почте', () => {
    const pub = identity({ label: 'Публичная', value: 'me@post.ru' })
    const bank = service({ emailId: pub.id, criticality: 'critical', name: 'Банк' })
    const v = vault(
      [pub],
      [bank, service({ emailId: pub.id }), service({ emailId: pub.id })],
    )
    expect(
      findProblems(v).some(
        (p) => p.kind === 'critical-on-public-email' && p.serviceId === bank.id,
      ),
    ).toBe(true)
  })

  it('замечает recovery, замкнутое на почту самого сервиса', () => {
    const mail = identity({ value: 'me@gmail.com' })
    const backup = identity({ value: 'backup@gmail.com' })
    const gmail = service({
      emailId: mail.id,
      recoveryEmailId: backup.id,
      domain: 'gmail.com',
      criticality: 'critical',
      name: 'Gmail',
    })
    const outside = identity({ value: 'safe@other-mail.ru' })
    const gmailSafe = service({
      emailId: mail.id,
      recoveryEmailId: outside.id,
      domain: 'gmail.com',
      criticality: 'critical',
      name: 'Gmail',
    })
    expect(
      findProblems(vault([mail, backup], [gmail])).some((p) => p.kind === 'recovery-self-loop'),
    ).toBe(true)
    expect(
      findProblems(vault([mail, outside], [gmailSafe])).some(
        (p) => p.kind === 'recovery-self-loop',
      ),
    ).toBe(false)
  })

  it('удалённые сервисы не участвуют в проблемах', () => {
    const trash = identity({ value: 'dump@post.ru' })
    const dead = service({
      emailId: trash.id,
      recoveryEmailId: trash.id,
      criticality: 'critical',
      status: 'deleted',
    })
    expect(findProblems(vault([trash], [dead]))).toEqual([])
  })
})

describe('migrationPlan', () => {
  it('почтовый провайдер едет раньше сервисов, которые от него зависят', () => {
    const gmailAddr = identity({ value: 'me@gmail.com' })
    const bankAddr = identity({ value: 'me@bank-mail.ru' })
    const gmail = service({ emailId: bankAddr.id, domain: 'gmail.com', name: 'Gmail' })
    const bank = service({
      emailId: gmailAddr.id,
      criticality: 'critical',
      domain: 'bank.ru',
      name: 'Банк',
    })
    const plan = migrationPlan(vault([gmailAddr, bankAddr], [gmail, bank]))
    const gmailStep = plan.find((s) => s.service.id === gmail.id)!
    const bankStep = plan.find((s) => s.service.id === bank.id)!
    expect(gmailStep.wave).toBeLessThan(bankStep.wave)
    expect(plan.indexOf(gmailStep)).toBeLessThan(plan.indexOf(bankStep))
    expect(bankStep.dependsOn.map((s) => s.id)).toContain(gmail.id)
    expect(gmailStep.dependents.map((s) => s.id)).toContain(bank.id)
  })

  it('взаимные recovery двух почт не зацикливают обход', () => {
    const a = identity({ value: 'a@mail-a.ru' })
    const b = identity({ value: 'b@mail-b.ru' })
    const mailA = service({ emailId: b.id, recoveryEmailId: b.id, domain: 'mail-a.ru' })
    const mailB = service({ emailId: a.id, recoveryEmailId: a.id, domain: 'mail-b.ru' })
    const plan = migrationPlan(vault([a, b], [mailA, mailB]))
    expect(plan).toHaveLength(2)
    expect(plan.some((s) => s.inCycle)).toBe(true)
  })
})

describe('audit', () => {
  const now = new Date('2026-08-04')

  it('находит сервисы без ревизии больше года', () => {
    const mail = identity({ value: 'x@y.ru' })
    const old = service({ emailId: mail.id, registeredAt: '2024-01-15', name: 'Старый' })
    const fresh = service({ emailId: mail.id, registeredAt: '2026-05-01', name: 'Свежий' })
    const reviewedOld = service({ emailId: mail.id, registeredAt: '2024-01-15', name: 'Проверенный' })
    const v = vault(
      [mail],
      [old, fresh, reviewedOld],
      [{ id: 'e1', serviceId: reviewedOld.id, type: 'reviewed', date: '2026-06-01' }],
    )
    const report = audit(v, now)
    expect(report.stale.map((s) => s.service.id)).toEqual([old.id])
  })

  it('ловит критичные сервисы на SMS и без 2FA, но не обычные', () => {
    const mail = identity({ value: 'x@y.ru' })
    const v = vault(
      [mail],
      [
        service({ emailId: mail.id, criticality: 'critical', twoFactor: 'sms', name: 'КритSMS' }),
        service({ emailId: mail.id, criticality: 'critical', twoFactor: 'none', name: 'КритБез' }),
        service({ emailId: mail.id, criticality: 'critical', twoFactor: 'totp' }),
        service({ emailId: mail.id, criticality: 'normal', twoFactor: 'sms' }),
      ],
    )
    expect(audit(v, now).weakTwoFactor.map((s) => s.name).sort()).toEqual(['КритSMS', 'КритБез'])
  })

  it('держит в списке запрошенные, но не подтверждённые удаления', () => {
    const mail = identity({ value: 'x@y.ru' })
    const limbo = service({ emailId: mail.id, status: 'deletion-requested' })
    expect(audit(vault([mail], [limbo]), now).unconfirmedDeletions.map((s) => s.id)).toEqual([
      limbo.id,
    ])
  })
})

describe('leakSuspects', () => {
  it('спам на алиас указывает на сервисы, где алиас — логин', () => {
    const alias = identity({ value: 'имя+ozon@post.ru', isAlias: true })
    const ozon = service({ emailId: alias.id, name: 'Ozon' })
    const other = service({ emailId: identity({}).id, name: 'Другой' })
    expect(leakSuspects(vault([alias], [ozon, other]), alias.id).map((s) => s.id)).toEqual([
      ozon.id,
    ])
  })
})
