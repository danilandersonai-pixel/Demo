import { describe, expect, it } from 'vitest';
import { BAL, BUILDINGS, RESEARCH } from './config';
import {
  build,
  computeFlow,
  createState,
  demolish,
  move,
  refactor,
  sell,
  setAutoSell,
  simulate,
  startResearch,
  step,
  toggle,
  upgrade,
} from './engine';
import { deserialize, serialize } from './save';
import { buildCost, getMods, refactorCost, upgradeCost } from './selectors';
import type { GameState } from './types';

function fresh(credits = 1e9): GameState {
  const s = createState(12345, 0);
  s.credits = credits;
  s.autoSell = { data: false, code: false };
  // Отключаем рыночные события, чтобы цены в тестах были предсказуемы.
  s.market.nextEventAt = Number.MAX_SAFE_INTEGER;
  return s;
}

function mustBuild(s: GameState, type: Parameters<typeof build>[1], x: number, y: number) {
  const r = build(s, type, x, y);
  if (!r.ok) throw new Error(`${type} @${x},${y}: ${r.error}`);
  return s.buildings[s.buildings.length - 1];
}

describe('постройка', () => {
  it('списывает деньги и дорожает с каждым зданием того же типа', () => {
    const s = fresh(10000);
    const c1 = buildCost(s, 'miner');
    mustBuild(s, 'miner', 1, 1);
    expect(s.credits).toBe(10000 - c1);
    const c2 = buildCost(s, 'miner');
    expect(c2).toBe(Math.round(BUILDINGS.miner.cost * BUILDINGS.miner.growth));
    expect(c2).toBeGreaterThan(c1);
  });

  it('не даёт строить на занятых и закрытых ячейках', () => {
    const s = fresh();
    mustBuild(s, 'miner', 1, 1);
    expect(build(s, 'miner', 1, 1).ok).toBe(false);
    expect(build(s, 'miner', 0, 0).ok).toBe(false); // внешнее кольцо закрыто до «Расширения цеха»
    expect(build(s, 'miner', 7, 7).ok).toBe(false);
  });

  it('не строит без денег', () => {
    const s = fresh(10);
    const r = build(s, 'reactor', 2, 2);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Не хватает/);
    expect(s.buildings).toHaveLength(0);
  });

  it('AGI требует исследования и блок 2×2, клик может быть любым углом', () => {
    const s = fresh();
    expect(build(s, 'agi', 3, 3).ok).toBe(false);
    s.research.done.push('transformers');
    mustBuild(s, 'miner', 4, 4);
    // Клик в (4,3): варианты с углом в (4,3) и (3,3) задевают здание в (4,4),
    // поэтому блок встаёт выше — с углом в (4,2).
    const agi = mustBuild(s, 'agi', 4, 3);
    expect([agi.x, agi.y]).toEqual([4, 2]);
    expect(build(s, 'agi', 0, 0).ok).toBe(false); // внешнее кольцо ещё закрыто
  });

  it('снос возвращает половину вложенного, включая улучшения', () => {
    const s = fresh();
    const b = mustBuild(s, 'coder', 2, 2);
    const up = upgradeCost(b);
    expect(upgrade(s, b.id).ok).toBe(true);
    const before = s.credits;
    demolish(s, b.id);
    expect(s.credits - before).toBe(Math.round((BUILDINGS.coder.cost + up) * BAL.refund));
    expect(s.buildings).toHaveLength(0);
  });

  it('перемещение проверяет свободное место', () => {
    const s = fresh();
    const a = mustBuild(s, 'miner', 1, 1);
    mustBuild(s, 'miner', 2, 1);
    expect(move(s, a.id, 2, 1).ok).toBe(false);
    expect(move(s, a.id, 5, 5).ok).toBe(true);
    expect([a.x, a.y]).toEqual([5, 5]);
  });
});

describe('энергосеть', () => {
  it('без реактора цех обесточен и ничего не производит', () => {
    const s = fresh();
    mustBuild(s, 'miner', 1, 1);
    step(s);
    expect(s.flow.blackout).toBe(true);
    expect(s.res.data).toBe(0);
  });

  it('при перегрузке фабрика гаснет целиком, а при запасе — работает', () => {
    const s = fresh();
    mustBuild(s, 'reactor', 1, 1); // 24 МВт
    for (let i = 0; i < 9; i++) mustBuild(s, 'miner', 2 + (i % 5), 2 + Math.floor(i / 5)); // 27 МВт
    step(s);
    expect(s.flow.blackout).toBe(true);
    expect(s.flow.prod.data).toBe(0);
    toggle(s, s.buildings[s.buildings.length - 1].id); // 24 МВт — ровно впритык
    step(s);
    expect(s.flow.blackout).toBe(false);
    expect(s.flow.prod.data).toBeCloseTo(8 * BAL.minerOut, 6);
  });

  it('«Умная энергосеть» заменяет блэкаут пропорциональным замедлением', () => {
    const s = fresh();
    s.research.done.push('smartGrid');
    mustBuild(s, 'reactor', 1, 1);
    for (let i = 0; i < 10; i++) mustBuild(s, 'miner', 2 + (i % 5), 2 + Math.floor(i / 5)); // 30 МВт
    step(s);
    expect(s.flow.blackout).toBe(false);
    expect(s.flow.brownout).toBe(true);
    expect(s.flow.power).toBeCloseTo(24 / 30, 6);
    expect(s.flow.prod.data).toBeCloseTo(10 * BAL.minerOut * (24 / 30), 6);
  });

  it('«Мягкий рефакторинг» снижает потребление Блоков вайбкодинга на 30%', () => {
    const s = fresh();
    mustBuild(s, 'coder', 1, 1);
    expect(computeFlow(s).load).toBeCloseTo(5, 6);
    s.research.done.push('softRefactor');
    expect(computeFlow(s).load).toBeCloseTo(3.5, 6);
  });
});

describe('производственная цепочка', () => {
  it('данные → код → модели → доход, баланс ресурсов сходится', () => {
    const s = fresh();
    mustBuild(s, 'reactor', 1, 1);
    mustBuild(s, 'reactor', 1, 2);
    for (let i = 0; i < 4; i++) mustBuild(s, 'miner', 3 + i % 2, 1 + Math.floor(i / 2));
    mustBuild(s, 'coder', 5, 1);
    mustBuild(s, 'coder', 5, 2);
    mustBuild(s, 'gpu', 3, 4);
    mustBuild(s, 'trainer', 4, 4);
    mustBuild(s, 'publisher', 5, 4);
    const startCredits = s.credits;
    for (let t = 0; t < 120; t++) {
      const before = { ...s.res };
      step(s);
      const f = s.flow;
      for (const k of ['data', 'code', 'models'] as const) {
        const sold = k === 'models' ? 0 : f.sold[k];
        expect(s.res[k]).toBeCloseTo(Math.max(0, before[k] + f.prod[k] - f.cons[k] - sold), 6);
      }
    }
    expect(s.stats.modelsTrained).toBeGreaterThan(5);
    expect(s.stats.modelsSold).toBeGreaterThan(3);
    expect(s.credits).toBeGreaterThan(startCredits);
    expect(s.flow.incomeSaas).toBeGreaterThan(0);
  });

  it('дефицит данных делится между потребителями пропорционально', () => {
    const s = fresh();
    mustBuild(s, 'reactor', 1, 1);
    mustBuild(s, 'coder', 3, 3);
    mustBuild(s, 'coder', 5, 5);
    s.res.data = BAL.coderIn; // спрос вдвое больше — каждому достанется ровно половина
    const f = computeFlow(s);
    const [a, b] = s.buildings.filter((x) => x.type === 'coder');
    expect(f.b[a.id].u).toBeCloseTo(0.5, 6);
    expect(f.b[b.id].u).toBeCloseTo(0.5, 6);
    expect(f.cons.data).toBeCloseTo(BAL.coderIn, 6);
    expect(f.b[a.id].lim).toBe('data');
  });

  it('прямой конвейер от соседа даёт +10% к скорости', () => {
    const s = fresh();
    mustBuild(s, 'reactor', 1, 1);
    const coder = mustBuild(s, 'coder', 3, 3);
    s.res.data = 1000;
    const alone = computeFlow(s).b[coder.id];
    mustBuild(s, 'miner', 3, 4);
    const linked = computeFlow(s).b[coder.id];
    expect(alone.adj).toBe(0);
    expect(linked.adj).toBe(1);
    expect(linked.speed).toBeCloseTo(alone.speed + BAL.adjBonus, 6);
    // На паузе сосед не считается поставщиком.
    toggle(s, s.buildings[2].id);
    expect(computeFlow(s).b[coder.id].adj).toBe(0);
  });

  it('полный склад останавливает добычу', () => {
    const s = fresh();
    mustBuild(s, 'reactor', 1, 1);
    mustBuild(s, 'miner', 2, 2);
    s.res.data = BAL.baseCaps.data - 1;
    step(s);
    expect(s.res.data).toBeCloseTo(BAL.baseCaps.data, 6);
    const miner = s.buildings[1];
    // Места хватило на треть выработки — загрузка неполная, причина — склад.
    expect(s.flow.b[miner.id].status).toBe('partial');
    expect(s.flow.b[miner.id].lim).toBe('space');
    step(s);
    expect(s.flow.b[miner.id].status).toBe('blocked');
    mustBuild(s, 'storage', 4, 4);
    expect(s.flow.caps.data).toBeCloseTo(BAL.baseCaps.data * 2, 6);
  });

  it('автопродажа сбывает только текущие излишки и не трогает резерв', () => {
    const s = fresh();
    mustBuild(s, 'reactor', 1, 1);
    mustBuild(s, 'miner', 2, 2);
    setAutoSell(s, 'data', true);
    const reserve = BAL.baseCaps.data * BAL.autoSellReserve;
    // Пока склад ниже резерва — копим.
    step(s);
    expect(s.flow.sold.data).toBe(0);
    expect(s.res.data).toBeCloseTo(BAL.minerOut, 6);
    // Выше резерва продаётся ровно выработка, старый запас остаётся на складе.
    s.res.data = 900;
    step(s);
    expect(s.flow.sold.data).toBeCloseTo(BAL.minerOut, 6);
    expect(s.res.data).toBeCloseTo(900, 6);
    expect(s.flow.incomeExchange).toBeGreaterThan(0);
    expect(900).toBeGreaterThan(reserve);
  });

  it('ручная продажа переводит сырьё в кредиты', () => {
    const s = fresh(0);
    s.res.code = 100;
    const r = sell(s, 'code', 1);
    expect(r.ok).toBe(true);
    expect(s.res.code).toBe(0);
    expect(s.credits).toBeGreaterThan(0);
  });
});

describe('рынок и AGI', () => {
  it('AGI забирает модели первым и платит ×10 за штуку', () => {
    const s = fresh();
    s.research.done.push('transformers');
    for (let i = 0; i < 4; i++) mustBuild(s, 'reactor', 1, 1 + i);
    // GPU и терминал ставим поодаль, чтобы бонус соседства не менял спрос AGI.
    mustBuild(s, 'gpu', 1, 5);
    mustBuild(s, 'gpu', 1, 6);
    mustBuild(s, 'gpu', 2, 6);
    mustBuild(s, 'agi', 4, 1);
    mustBuild(s, 'publisher', 6, 6);
    s.res.models = 0.5; // ровно столько, сколько AGI съедает за тик
    const f = computeFlow(s);
    const agi = s.buildings.find((b) => b.type === 'agi')!;
    const pub = s.buildings.find((b) => b.type === 'publisher')!;
    expect(f.b[agi.id].u).toBeCloseTo(1, 6);
    expect(f.b[pub.id].u).toBeCloseTo(0, 6);
    expect(f.incomeAgi).toBeCloseTo(0.5 * f.price * BAL.agiMult, 6);
  });

  it('цена модели остаётся в разумных пределах', () => {
    const s = createState(7, 0);
    for (let t = 0; t < 5000; t++) {
      step(s);
      expect(s.flow.price).toBeGreaterThan(BAL.price.model * 0.25);
      expect(s.flow.price).toBeLessThan(BAL.price.model * 2.5);
    }
  });
});

describe('техдолг', () => {
  it('копится при работе, режет КПД и чистится рефакторингом', () => {
    const s = fresh();
    mustBuild(s, 'reactor', 1, 1);
    const coder = mustBuild(s, 'coder', 3, 3);
    s.res.data = 500;
    for (let i = 0; i < 100; i++) step(s);
    expect(coder.debt).toBeCloseTo(100 * BAL.debtRate, 1);
    const eff = s.flow.b[coder.id].eff;
    expect(eff).toBeLessThan(1);
    const cost = refactorCost(s);
    const before = s.credits;
    expect(refactor(s).ok).toBe(true);
    expect(coder.debt).toBe(0);
    expect(before - s.credits).toBe(cost);
    expect(refactor(s).ok).toBe(false);
  });

  it('CI/CD-конвейер чистит блоки сам', () => {
    const s = fresh();
    s.research.done.push('cicd');
    mustBuild(s, 'reactor', 1, 1);
    const coder = mustBuild(s, 'coder', 3, 3);
    coder.debt = BAL.autoRefactorAt + 1;
    s.res.data = 100;
    step(s);
    expect(coder.debt).toBe(0);
    expect(s.stats.autoRefactors).toBe(1);
  });
});

describe('исследования', () => {
  it('списывают кредиты сразу, а код — по ходу работы', () => {
    const s = fresh();
    s.res.code = 10000;
    const r = startResearch(s, 'conveyor');
    expect(r.ok).toBe(true);
    expect(startResearch(s, 'softRefactor').ok).toBe(false); // лаборатория занята
    // При обесточивании исследование стоит.
    mustBuild(s, 'miner', 2, 2);
    step(s);
    expect(s.flow.blackout).toBe(true);
    expect(s.research.active?.paid).toBe(0);
    mustBuild(s, 'reactor', 1, 1);
    for (let i = 0; i < RESEARCH.conveyor.time; i++) step(s);
    expect(s.research.done).toContain('conveyor');
    expect(getMods(s).speed).toBeCloseTo(0.25, 6);
  });

  it('делят дефицитный код с кластерами обучения пропорционально', () => {
    const s = fresh();
    mustBuild(s, 'reactor', 1, 1);
    mustBuild(s, 'reactor', 1, 2);
    mustBuild(s, 'gpu', 3, 3);
    const trainer = mustBuild(s, 'trainer', 5, 5);
    s.res.data = 100;
    const rate = RESEARCH.conveyor.code / RESEARCH.conveyor.time;
    s.res.code = (BAL.trainerCode + rate) / 2; // хватает ровно на половину общего спроса
    startResearch(s, 'conveyor');
    const f = computeFlow(s);
    expect(f.b[trainer.id].u).toBeCloseTo(0.5, 6);
    expect(f.researchDraw).toBeCloseTo(rate / 2, 6);
    expect(f.cons.code).toBeCloseTo(s.res.code, 6);
  });

  it('требуют выполненных предпосылок', () => {
    const s = fresh();
    expect(startResearch(s, 'transformers').ok).toBe(false);
    expect(startResearch(s, 'codeReview').ok).toBe(false);
    s.research.done.push('softRefactor');
    expect(startResearch(s, 'codeReview').ok).toBe(true);
  });
});

describe('сохранение и офлайн', () => {
  it('состояние переживает сериализацию', () => {
    const s = fresh();
    mustBuild(s, 'reactor', 1, 1);
    mustBuild(s, 'miner', 2, 1);
    for (let i = 0; i < 30; i++) step(s);
    const copy = deserialize(serialize(s))!;
    expect(copy).not.toBeNull();
    expect(copy.buildings).toEqual(s.buildings);
    expect(copy.res).toEqual(s.res);
    expect(copy.credits).toBe(s.credits);
    expect(copy.tick).toBe(s.tick);
    expect(copy.rng).toBe(s.rng);
  });

  it('битые сохранения отбрасываются, а пересекающиеся здания не загружаются', () => {
    expect(deserialize('{nope')).toBeNull();
    expect(deserialize(JSON.stringify({ v: 2 }))).toBeNull();
    const s = fresh();
    mustBuild(s, 'miner', 2, 2);
    const raw = JSON.parse(serialize(s));
    raw.buildings.push({ ...raw.buildings[0], id: 99 });
    raw.buildings.push({ id: 100, type: 'unknown', x: 1, y: 1 });
    const copy = deserialize(JSON.stringify(raw))!;
    expect(copy.buildings).toHaveLength(1);
  });

  it('офлайн-прогресс детерминирован', () => {
    const a = fresh();
    mustBuild(a, 'reactor', 1, 1);
    mustBuild(a, 'miner', 2, 1);
    mustBuild(a, 'coder', 3, 1);
    const b = deserialize(serialize(a))!;
    const ra = simulate(a, 600);
    const rb = simulate(b, 600);
    expect(ra).toEqual(rb);
    expect(a.res).toEqual(b.res);
    expect(ra.code).toBeGreaterThan(0);
  });
});

describe('регрессии из ревью', () => {
  it('автопродажа разгружает полный склад: добыча не встаёт навсегда', () => {
    const s = fresh();
    mustBuild(s, 'reactor', 1, 1);
    const miner = mustBuild(s, 'miner', 2, 2);
    s.res.data = BAL.baseCaps.data; // склад забит под завязку
    step(s);
    expect(s.flow.b[miner.id].status).toBe('blocked');
    setAutoSell(s, 'data', true);
    step(s);
    expect(s.flow.b[miner.id].u).toBeCloseTo(1, 6);
    expect(s.flow.sold.data).toBeCloseTo(BAL.minerOut, 6);
    expect(s.res.data).toBeCloseTo(BAL.baseCaps.data, 6); // запас не превысил вместимость
  });

  it('AGI без моделей не отнимает вычисления у кластеров обучения', () => {
    const s = fresh();
    s.research.done.push('transformers');
    for (let i = 0; i < 4; i++) mustBuild(s, 'reactor', 1, 1 + i);
    mustBuild(s, 'gpu', 6, 6); // 10 PFLOPS
    const trainer = mustBuild(s, 'trainer', 6, 1); // нужно 5 PFLOPS
    mustBuild(s, 'agi', 3, 1); // нужно 30 PFLOPS, но моделей нет
    s.res.data = 500;
    s.res.code = 500;
    s.res.models = 0;
    const f = computeFlow(s);
    expect(f.b[trainer.id].u).toBeCloseTo(1, 6);
    expect(f.computeNeedMax).toBeGreaterThan(f.computeSupply);
    expect(f.computeDemand).toBeCloseTo(BAL.trainerCompute, 6);
  });

  it('исследование не зависает у 100% при дефиците кода', () => {
    const s = fresh();
    for (let i = 0; i < 3; i++) mustBuild(s, 'reactor', 1, 1 + i);
    for (let i = 0; i < 3; i++) mustBuild(s, 'trainer', 3 + i, 1);
    mustBuild(s, 'gpu', 3, 3);
    mustBuild(s, 'gpu', 4, 3);
    mustBuild(s, 'coder', 6, 6);
    mustBuild(s, 'miner', 5, 6);
    mustBuild(s, 'miner', 4, 6);
    s.res.data = 2000;
    startResearch(s, 'softRefactor');
    let almost = -1;
    for (let t = 0; t < 3000 && s.research.active; t++) {
      step(s);
      const act = s.research.active;
      if (almost < 0 && act && act.paid >= RESEARCH.softRefactor.code * 0.99) almost = s.tick;
    }
    expect(s.research.done).toContain('softRefactor');
    // Последний процент добирается за считанные секунды, а не за минуты.
    expect(s.tick - almost).toBeLessThan(10);
  });

  it('распродажа накопленных моделей не накручивает рекордный доход', () => {
    const s = fresh();
    for (let i = 0; i < 3; i++) mustBuild(s, 'reactor', 1, 1 + i);
    mustBuild(s, 'gpu', 3, 3);
    mustBuild(s, 'trainer', 5, 5);
    const pubs = [mustBuild(s, 'publisher', 2, 5), mustBuild(s, 'publisher', 2, 6), mustBuild(s, 'publisher', 3, 6)];
    s.res.data = 900;
    s.res.code = 700;
    s.res.models = BAL.baseCaps.models; // терминалы копили склад моделей
    for (const p of pubs) expect(p.enabled).toBe(true);
    step(s);
    const f = s.flow;
    expect(f.incomeSaas).toBeGreaterThan(0);
    // Засчитывается не больше, чем обеспечено выпуском моделей на этом тике.
    expect(f.incomeSustained).toBeLessThanOrEqual(f.prod.models * f.price + f.incomeExchange + 1e-6);
    expect(f.incomeSustained).toBeLessThan(f.income);
    expect(s.incomeHistory[s.incomeHistory.length - 1]).toBeCloseTo(f.incomeSustained, 6);
  });

  it('выход из блэкаута в дефицит мощности не выдаётся за восстановление', () => {
    const s = fresh();
    s.research.done.push('smartGrid');
    const reactor = mustBuild(s, 'reactor', 1, 1);
    for (let i = 0; i < 10; i++) mustBuild(s, 'miner', 2 + (i % 5), 2 + Math.floor(i / 5)); // 30 МВт
    toggle(s, reactor.id);
    expect(s.flow.blackout).toBe(true);
    const r = toggle(s, reactor.id);
    expect(s.flow.brownout).toBe(true);
    const titles = (r.notices ?? []).map((n) => n.title);
    expect(titles).toContain('Дефицит мощности');
    expect(titles).not.toContain('Питание восстановлено');
  });

  it('узел засчитывается в рекорд только после пусконаладки', () => {
    const s = fresh();
    mustBuild(s, 'reactor', 1, 1);
    const miner = mustBuild(s, 'miner', 2, 2);
    for (let i = 0; i < BAL.commissionTicks - 1; i++) step(s);
    expect(s.stats.commissioned).toBe(0);
    demolish(s, miner.id); // снесли до конца пусконаладки — в рекорд не попал
    step(s);
    expect(s.stats.commissioned).toBe(1); // засчитан только реактор
  });

  it('битая запись журнала без id отбрасывается при загрузке', () => {
    const s = fresh();
    const raw = JSON.parse(serialize(s));
    raw.log.push({ t: 5, kind: 'info', text: 'без id' });
    const copy = deserialize(JSON.stringify(raw))!;
    expect(copy.log.every((e) => Number.isFinite(e.id))).toBe(true);
    expect(Number.isFinite(copy.logSeq)).toBe(true);
  });
});

