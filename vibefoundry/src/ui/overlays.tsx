import { useEffect, useState } from 'preact/hooks';
import type { Game } from '../game';
import { ERA_NAMES, ERA_SUB, SCRIPT_SLOTS, AGENT_SLOTS } from '../ai/eras';
import { ITEMS, type ItemId } from '../data/items';
import type { CiTest } from '../ai/state';
import { Icon } from './icons';
import { fmt, fmtInt, gameTime } from './format';

const ERA_TEXT: Record<number, string[]> = {
  2: ['Найм агентов: Coder, Debugger, Optimizer…', `До ${SCRIPT_SLOTS[2]} постоянных скриптов`, 'Песочница и CI-тесты после исследований', 'Вайб-панель превращается в IDE'],
  3: ['Агенты получают физическое тело — дронов', 'dispatch() и build() в скриптах', 'Architect ставит чертежи линий', 'Рабочие, логистические, инженерные и боевые дроны'],
  4: ['Orchestrator сам ставит цели колонии', 'Автопилот и Индекс автономии', 'Шпиль Колонии — финальное мегасооружение', `До ${AGENT_SLOTS[4]} агентов`],
};
const ERA_ICON = ['', 'terminal', 'cpu', 'drone', 'home'];

export function EraCutscene({ game }: { game: Game }) {
  const c = game.ui.cutscene;
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!c) return;
    setT(0);
    const id = setInterval(() => setT((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [c?.era]);
  useEffect(() => {
    if (c && t >= 9) {
      game.ui.cutscene = null;
      game.emit();
    }
  }, [t]);
  if (!c) return null;
  return (
    <div class="cutscene" onClick={() => { game.ui.cutscene = null; game.emit(); }}>
      <div class="cs-inner">
        <div class="cs-icon"><Icon name={ERA_ICON[c.era]} size={64} /></div>
        <div class="label" style={{ color: 'var(--teal-soft)', fontSize: 13 }}>Новая эра · {c.era} из 4</div>
        <div class="cs-title">{ERA_NAMES[c.era]}</div>
        <div class="muted" style={{ fontSize: 16 }}>{ERA_SUB[c.era]}</div>
        <div class="cs-list">
          {(ERA_TEXT[c.era] ?? []).map((x, i) => <div key={x} style={{ animationDelay: `${0.4 + i * 0.25}s` }}><Icon name="check" size={16} /> {x}</div>)}
        </div>
        <button class="btn primary" style={{ marginTop: 20 }}>Продолжить</button>
      </div>
    </div>
  );
}

export function Victory({ game }: { game: Game }) {
  if (!game.ui.victory) return null;
  const sim = game.sim;
  const produced = Object.entries(sim.stats.totalProduced).filter(([k]) => k in ITEMS).reduce((s, [, n]) => s + n, 0);
  const chips = sim.stats.totalProduced.microchip ?? 0;
  return (
    <div class="victory">
      <div class="v-inner">
        <div class="label" style={{ color: 'var(--violet)', fontSize: 13 }}>Победа</div>
        <div class="v-title">От фабрики к цивилизации</div>
        <div style={{ fontSize: 16, color: 'var(--text-2)', maxWidth: 620, textAlign: 'center', lineHeight: 1.5 }}>
          Шпиль Колонии светится над островом. Агенты управляют производством сами — ты создал ИИ, который строит колонию без тебя.
        </div>
        <div class="v-stats">
          <div><b>{gameTime(sim.time)}</b><span>игрового времени</span></div>
          <div><b>{fmt(produced)}</b><span>предметов произведено</span></div>
          <div><b>{fmt(chips)}</b><span>микросхем</span></div>
          <div><b>{sim.git.commits.length}</b><span>коммитов в Git</span></div>
          <div><b>{sim.ai.agents.length - 1}</b><span>агентов</span></div>
          <div><b>{Math.round(sim.ai.autonomy * 100)}%</b><span>автономии</span></div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button class="btn primary" onClick={() => { game.ui.victory = false; sim.ai.victoryShown = true; game.emit(); }}>Продолжить — бесконечный режим</button>
          <button class="btn" onClick={() => { game.ui.victory = false; game.ui.mainMenu = true; game.emit(); }}>Главное меню</button>
        </div>
      </div>
    </div>
  );
}

/** CI-station panel section: production tests with pass/fail. */
export function CiPanel({ game }: { game: Game }) {
  const sim = game.sim;
  const [kind, setKind] = useState<CiTest['kind']>('rate_ge');
  const [item, setItem] = useState<ItemId>('microchip');
  const [value, setValue] = useState('100');
  const add = () => {
    const v = Number(value);
    if (!Number.isFinite(v)) return;
    const val = kind === 'power_ge' ? (v > 1 ? v / 100 : v) : v;
    const name = kind === 'power_ge' ? `энергия никогда не ниже ${Math.round(val * 100)}%` : kind === 'rate_ge' ? `${ITEMS[item].short} ≥ ${v}/мин` : `запас: ${ITEMS[item].short} ≥ ${v}`;
    sim.ai.ciTests.push({ id: sim.ai.nextTestId++, name, kind, key: kind === 'power_ge' ? 'power' : item, value: val, pass: false });
    game.emit();
  };
  return (
    <div style={{ padding: '6px 0' }}>
      <div class="label" style={{ marginBottom: 6 }}>Тесты производства</div>
      {sim.ai.ciTests.map((t) => (
        <div key={t.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, padding: '2px 0' }}>
          <span class={t.pass ? 'pos' : 'neg'}><Icon name={t.pass ? 'success' : 'danger'} size={14} /></span>
          <span style={{ flex: 1 }}>{t.name}{t.kind === 'power_ge' && t.everFailed ? <span class="warn"> (был провал)</span> : null}</span>
          <button class="xbtn" style={{ width: 22, height: 22, border: 'none' }} onClick={() => { sim.ai.ciTests = sim.ai.ciTests.filter((x) => x.id !== t.id); game.emit(); }}><Icon name="close" size={12} /></button>
        </div>
      ))}
      {!sim.ai.ciTests.length && <div class="muted" style={{ fontSize: 12 }}>Тестов нет. Добавьте здесь или попросите агента: «Добавь тест: микросхем ≥ 100 в минуту».</div>}
      <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
        <select value={kind} onChange={(e) => setKind((e.target as HTMLSelectElement).value as CiTest['kind'])} style={{ padding: '3px 4px', fontSize: 12 }}>
          <option value="rate_ge">скорость ≥</option>
          <option value="stock_ge">запас ≥</option>
          <option value="power_ge">энергия ≥ %</option>
        </select>
        {kind !== 'power_ge' && (
          <select value={item} onChange={(e) => setItem((e.target as HTMLSelectElement).value as ItemId)} style={{ padding: '3px 4px', fontSize: 12, maxWidth: 120 }}>
            {Object.values(ITEMS).filter((i) => !i.fluid).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        )}
        <input value={value} onInput={(e) => setValue((e.target as HTMLInputElement).value)} style={{ width: 60, padding: '3px 6px', fontSize: 12 }} class="mono" />
        <button class="btn small" onClick={add}>+ Тест</button>
      </div>
      {void fmtInt}
    </div>
  );
}
