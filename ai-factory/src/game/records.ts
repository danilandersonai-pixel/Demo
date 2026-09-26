// Рекорды живут отдельно от сохранения фабрики и переживают сброс:
// максимальный пассивный доход и общее число построенных узлов.

export interface Records {
  v: 1;
  maxIncome: number;
  maxIncomeAt: number | null;
  totalBuilt: number;
  /** Порог, после которого новый рекорд дохода снова празднуется. */
  nextIncomeCelebration: number;
  /** Последний отпразднованный рубеж по постройкам. */
  builtMilestone: number;
  factories: number;
  /** Самый быстрый запуск AGI, в игровых секундах. */
  fastestAgi: number | null;
}

export const BUILT_MILESTONES = [5, 10, 25, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000];

/** Во сколько раз нужно превзойти прошлый отпразднованный рекорд, чтобы снова устроить салют. */
export const INCOME_STEP = 1.3;
export const INCOME_FIRST = 20;

export interface Celebration {
  id: number;
  kind: 'income' | 'built';
  value: number;
  prev: number;
}

export function defaultRecords(): Records {
  return {
    v: 1,
    maxIncome: 0,
    maxIncomeAt: null,
    totalBuilt: 0,
    nextIncomeCelebration: INCOME_FIRST,
    builtMilestone: 0,
    factories: 1,
    fastestAgi: null,
  };
}

export function sanitizeRecords(o: unknown): Records {
  const d = defaultRecords();
  if (!o || typeof o !== 'object') return d;
  const r = o as Partial<Records>;
  const numOr = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fb);
  return {
    v: 1,
    maxIncome: numOr(r.maxIncome, d.maxIncome),
    maxIncomeAt: typeof r.maxIncomeAt === 'number' ? r.maxIncomeAt : null,
    totalBuilt: Math.floor(numOr(r.totalBuilt, 0)),
    nextIncomeCelebration: Math.max(INCOME_FIRST, numOr(r.nextIncomeCelebration, INCOME_FIRST)),
    builtMilestone: numOr(r.builtMilestone, 0),
    factories: Math.max(1, Math.floor(numOr(r.factories, 1))),
    fastestAgi: typeof r.fastestAgi === 'number' && r.fastestAgi > 0 ? r.fastestAgi : null,
  };
}

/** Обновляет рекорд дохода. celebrate — стоит ли показать салют. */
export function trackIncome(r: Records, income: number, now: number): { r: Records; celebrate: boolean; prev: number } {
  if (!(income > r.maxIncome + 1e-9)) return { r, celebrate: false, prev: r.maxIncome };
  const prev = r.maxIncome;
  const next: Records = { ...r, maxIncome: income, maxIncomeAt: now };
  if (income >= r.nextIncomeCelebration) {
    next.nextIncomeCelebration = income * INCOME_STEP;
    return { r: next, celebrate: true, prev };
  }
  return { r: next, celebrate: false, prev };
}

/** Учитывает новые постройки. milestone — рубеж, который только что взят. */
export function trackBuilt(r: Records, count = 1): { r: Records; milestone: number | null } {
  const total = r.totalBuilt + count;
  let milestone: number | null = null;
  for (const m of BUILT_MILESTONES) {
    if (m > r.builtMilestone && total >= m) milestone = m;
  }
  return {
    r: { ...r, totalBuilt: total, builtMilestone: milestone ?? r.builtMilestone },
    milestone,
  };
}

export function trackAgi(r: Records, tick: number): Records {
  if (r.fastestAgi !== null && r.fastestAgi <= tick) return r;
  return { ...r, fastestAgi: tick };
}

/** Новая фабрика: салют будет, как только она побьёт исторический рекорд. */
export function onNewFactory(r: Records): Records {
  return {
    ...r,
    factories: r.factories + 1,
    nextIncomeCelebration: Math.max(INCOME_FIRST, r.maxIncome),
  };
}
