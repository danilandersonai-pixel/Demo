import { useState } from 'preact/hooks';
import type { Game } from '../game';
import { TECH_LIST, TECHS, techDepth, type PackId } from '../data/research';
import { BUILDING_LIST, BUILDINGS, CATEGORY_NAMES } from '../data/buildings';
import { RECIPE_LIST, RECIPES } from '../data/recipes';
import { ITEMS, ITEM_LIST, type ItemId } from '../data/items';
import { DRONE_COST, DRONE_NAMES, DRONE_TECH, nearestPoi, sendToPoi } from '../sim/drones';
import type { DroneKind } from '../sim/types';
import { ROLES, HIRABLE } from '../ai/agents';
import { ERA_NAMES, ERA_SUB } from '../ai/eras';
import { mainPower } from '../sim/power';
import { Icon, ResIcon } from './icons';
import { ItemImg, itemName } from './hud';
import { thumb } from './thumbs';
import { Window } from './App';
import { fmt, mw, pct } from './format';
import { CodeView } from './code';
import { audio } from './audio';

const PACK_COLOR: Record<PackId, string> = { science_mech: '#d37c4f', science_elec: '#32c6f4', science_ai: '#33c0a7', science_auto: '#9096db' };

// ------------------------------------------------------------------ Research
export function ResearchWindow({ game }: { game: Game }) {
  const sim = game.sim;
  const memo: Record<string, number> = {};
  const cols: string[][] = [];
  for (const t of TECH_LIST) {
    const d = techDepth(t.id, memo);
    (cols[d] ??= []).push(t.id);
  }
  const NW = 186;
  const NH = 74;
  const GX = 60;
  const GY = 14;
  const pos: Record<string, { x: number; y: number }> = {};
  cols.forEach((ids, c) => ids.forEach((id, r) => (pos[id] = { x: c * (NW + GX), y: r * (NH + GY) })));
  const W = cols.length * (NW + GX);
  const H = Math.max(...cols.map((c) => c.length)) * (NH + GY);
  const cur = sim.research.current;
  const available = (id: string) => TECHS[id].prereq.every((p) => sim.doneSet.has(p));
  const select = (id: string) => {
    if (sim.doneSet.has(id)) return;
    if (!available(id)) {
      // queue prerequisites first
      const chain: string[] = [];
      const visit = (t: string) => {
        if (sim.doneSet.has(t) || chain.includes(t)) return;
        for (const p of TECHS[t].prereq) visit(p);
        chain.push(t);
      };
      visit(id);
      sim.research.current = chain[0];
      sim.research.queue = chain.slice(1);
    } else {
      sim.research.current = id;
      sim.research.queue = [];
    }
    audio.play('click');
    game.emit();
  };
  const labs = sim.list.filter((e) => e.type === 'lab' && !e.ghost).length;
  const t = cur ? TECHS[cur] : null;
  return (
    <Window title="Исследования" icon="research" width={1320} onClose={() => { game.ui.panel = null; game.emit(); }}
      extra={<span class="muted" style={{ fontSize: 12.5 }}>{sim.research.done.length}/{TECH_LIST.length} изучено · лабораторий: {labs}{t ? ` · сейчас: ${t.name} ${Math.floor(sim.research.progress[t.id] ?? 0)}/${t.count}` : ''}</span>}>
      {!labs && <div class="warn" style={{ marginBottom: 8, fontSize: 13 }}><Icon name="alert" size={14} /> Постройте лабораторию и подавайте в неё пакеты исследований манипуляторами.</div>}
      <div class="tree scroll" style={{ overflow: 'auto', maxHeight: 'calc(100vh - 300px)' }}>
        <div style={{ position: 'relative', width: W, height: H }}>
          <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
            {TECH_LIST.flatMap((tt) => tt.prereq.map((p) => {
              const a = pos[p];
              const b = pos[tt.id];
              const done = sim.doneSet.has(p);
              return <path key={p + tt.id} d={`M${a.x + NW} ${a.y + NH / 2} C${a.x + NW + GX / 2} ${a.y + NH / 2}, ${b.x - GX / 2} ${b.y + NH / 2}, ${b.x} ${b.y + NH / 2}`} stroke={done ? '#1c5f52' : '#163049'} stroke-width="1.5" fill="none" />;
            }))}
          </svg>
          {TECH_LIST.map((tt) => {
            const p = pos[tt.id];
            const done = sim.doneSet.has(tt.id);
            const av = available(tt.id);
            const isCur = cur === tt.id;
            const queued = sim.research.queue.includes(tt.id);
            const prog = (sim.research.progress[tt.id] ?? 0) / tt.count;
            const unlocks = [...BUILDING_LIST.filter((b) => b.unlock === tt.id).map((b) => b.name), ...RECIPE_LIST.filter((r) => r.unlock === tt.id).map((r) => r.name)];
            return (
              <button key={tt.id} class={'tnode' + (done ? ' done' : av ? ' av' : ' locked') + (isCur ? ' cur' : '') + (queued ? ' q' : '')} style={{ left: p.x, top: p.y, width: NW, height: NH }} onClick={() => select(tt.id)}
                data-tip={`${tt.desc}${unlocks.length ? ' Открывает: ' + unlocks.join(', ') + '.' : ''} Стоимость: ${tt.count} × (${tt.packs.map((k) => ITEMS[k].name).join(' + ')}), ${tt.time} с на единицу.`}>
                <div class="tn">{tt.name}</div>
                <div class="tp">
                  {tt.packs.map((k) => <span key={k} class="pk" style={{ background: PACK_COLOR[k] }} />)}
                  <span class="mono">×{tt.count}</span>
                  {done ? <span class="pos" style={{ marginLeft: 'auto' }}><Icon name="check" size={13} /></span> : isCur ? <span class="mono" style={{ marginLeft: 'auto', color: 'var(--cyan-soft)' }}>{pct(prog)}</span> : queued ? <span class="muted" style={{ marginLeft: 'auto', fontSize: 10.5 }}>в очереди</span> : null}
                </div>
                {(isCur || (prog > 0 && !done)) && <div class="bar" style={{ height: 3, marginTop: 4 }}><i style={{ width: pct(prog) }} /></div>}
              </button>
            );
          })}
        </div>
      </div>
    </Window>
  );
}

// ------------------------------------------------------------------ Drones & logistics
export function DronesWindow({ game }: { game: Game }) {
  const sim = game.sim;
  const kinds: DroneKind[] = ['construction', 'worker', 'logistic', 'engineer', 'combat'];
  const ports = sim.list.filter((e) => e.type === 'droneport' && !e.ghost);
  const stock = sim.stockAll();
  const build = (k: DroneKind) => {
    const home = ports[0] ?? sim.hq!;
    if (!sim.takeStock(DRONE_COST[k])) return;
    sim.addDrone(k, home.id);
    sim.flags.dronesBuilt = (sim.flags.dronesBuilt ?? 0) + 1;
    audio.play('build');
    game.pushToast({ kind: 'success', title: `${DRONE_NAMES[k]} собран`, text: `База: ${ports.length ? 'дрон-порт' : 'HQ'}` });
  };
  const pois = sim.world.pois.filter((p) => !p.explored);
  const hq = sim.hq!;
  const next = nearestPoi(sim, hq.x, hq.y);
  const DESC: Record<DroneKind, string> = {
    construction: 'Строят призраки и сносят здания в радиусе базы (45) и дрон-портов (30).',
    worker: 'Разведчики: экспедиции к точкам «?», открывают туман войны.',
    logistic: 'Возят недостающее сырьё со складов в голодные цеха и забирают забитые выходы.',
    engineer: 'Чинят повреждённые здания.',
    combat: 'Атакуют сбойные автоматы в радиусе 40 от базы.',
  };
  return (
    <Window title="Логистика и дроны" icon="drone" width={980} onClose={() => { game.ui.panel = null; game.emit(); }}
      extra={<span class="muted" style={{ fontSize: 12.5 }}>Дронов: {sim.drones.length} · дрон-портов: {ports.length} · врагов: {sim.enemies.length}</span>}>
      <div class="drone-grid">
        {kinds.map((k) => {
          const list = sim.drones.filter((d) => d.kind === k);
          const tech = DRONE_TECH[k];
          const unlocked = k === 'construction' ? sim.isUnlocked('droneport') : sim.isUnlocked(tech);
          const busy = list.filter((d) => d.state !== 'idle').length;
          const lack = DRONE_COST[k].some((c) => (stock[c.item] ?? 0) < c.n);
          return (
            <div class="dcard" key={k}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <b style={{ color: 'var(--text)' }}>{DRONE_NAMES[k]}</b>
                <span class="mono" style={{ marginLeft: 'auto' }}>{list.length}</span>
              </div>
              <div class="muted" style={{ fontSize: 12, minHeight: 34 }}>{DESC[k]}</div>
              <div style={{ fontSize: 12 }}>Заняты: {busy} / {list.length}{list.some((d) => d.state === 'rogue') ? <span class="neg"> · вышли из-под контроля!</span> : null}</div>
              <div class="cost" style={{ justifyContent: 'flex-start' }}>{DRONE_COST[k].map((c) => <span key={c.item} class={(stock[c.item] ?? 0) < c.n ? 'lack' : ''}><ItemImg id={c.item} size={14} />{c.n}</span>)}</div>
              <button class="btn small primary" disabled={!unlocked || lack} onClick={() => build(k)} data-tip={!unlocked ? `Нужно исследование «${TECHS[k === 'construction' ? 'droneport' : tech!]?.name}»` : lack ? 'Не хватает материалов на складах' : 'Собрать дрона'}>
                {unlocked ? 'Собрать' : <><Icon name="lock" size={12} /> {TECHS[k === 'construction' ? 'droneport' : tech!]?.name}</>}
              </button>
            </div>
          );
        })}
      </div>
      <div class="divider" style={{ margin: '14px 0' }} />
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 320 }}>
          <div class="label" style={{ marginBottom: 6 }}>Экспедиции · неизвестные области</div>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, marginBottom: 6 }}>
            <input type="checkbox" checked={!!sim.flags.autoExplore} onChange={(e) => { sim.flags.autoExplore = (e.target as HTMLInputElement).checked; game.emit(); }} /> Рабочие дроны исследуют «?» сами
          </label>
          <div class="scroll" style={{ maxHeight: 220 }}>
            {pois.slice(0, 20).map((p) => (
              <div class="row" key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
                <span style={{ color: 'var(--amber)' }}><Icon name="question" size={16} /></span>
                <span class="mono">({p.x}, {p.y})</span>
                <span class="muted">{Math.round(Math.hypot(p.x - hq.x, p.y - hq.y))} тайлов</span>
                {p.claimedBy ? <span class="pos" style={{ marginLeft: 'auto' }}>дрон в пути</span> : (
                  <button class="btn small" style={{ marginLeft: 'auto' }} onClick={() => {
                    const d = sim.drones.find((x) => (x.kind === 'worker' || x.kind === 'construction') && x.state === 'idle');
                    if (d && sendToPoi(sim, d, p.id)) game.pushToast({ kind: 'info', title: 'Экспедиция отправлена', text: `${DRONE_NAMES[d.kind]} → (${p.x}, ${p.y})` });
                    else game.pushToast({ kind: 'warning', title: 'Нет свободных дронов' });
                    game.emit();
                  }}>Отправить</button>
                )}
                <button class="btn small ghost" onClick={() => game.focusTile(p.x, p.y, 0.9)}><Icon name="eye" size={13} /></button>
              </div>
            ))}
            {!pois.length && <div class="muted">Все точки исследованы.</div>}
          </div>
          {next && <div class="muted" style={{ fontSize: 12, marginTop: 6 }}>Ближайшая: ({next.x}, {next.y}). Скрипт: <span class="mono">self.dispatch("scout", "nearest_unknown")</span></div>}
        </div>
        <div style={{ width: 300 }}>
          <div class="label" style={{ marginBottom: 6 }}>Склады</div>
          <div class="inv">{Object.entries(stock).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 24).map(([k, n]) => <span class="slot" key={k} data-tip={itemName(k)}><ItemImg id={k} />{fmt(n)}</span>)}</div>
        </div>
      </div>
    </Window>
  );
}

// ------------------------------------------------------------------ Statistics
export function StatsWindow({ game }: { game: Game }) {
  const sim = game.sim;
  const [scale, setScale] = useState<1 | 10 | 60>(1);
  const [key, setKey] = useState<string>('iron_plate');
  const keys = sim.stats.keys.filter((k) => k in ITEMS || ['compute', 'tokens', 'data', 'weights'].includes(k));
  const rows = keys
    .map((k) => ({ k, p: sim.stats.rate(k), c: sim.stats.consumeRate(k), total: sim.stats.totalProduced[k] ?? 0 }))
    .sort((a, b) => b.total - a.total);
  const series = sim.stats.series(key, scale);
  const max = Math.max(1, ...series.p, ...series.c);
  const W = 560;
  const H = 200;
  const pts = (arr: number[]) => arr.map((v, i) => `${(i / (arr.length - 1)) * W},${H - (v / max) * (H - 10)}`).join(' ');
  const label = (k: string) => (k in ITEMS ? ITEMS[k as ItemId].name : k === 'compute' ? 'Вычисления' : k === 'tokens' ? 'Токены' : k === 'data' ? 'Данные' : 'Веса модели');
  const net = mainPower(sim);
  return (
    <Window title="Статистика производства" icon="stats" width={1040} onClose={() => { game.ui.panel = null; game.emit(); }}
      extra={<span class="muted" style={{ fontSize: 12.5 }}>Энергия: {mw(net.used)} / {mw(net.capacity)} · удовлетворение {pct(net.sat)}</span>}>
      <div style={{ display: 'flex', gap: 16 }}>
        <div class="scroll" style={{ width: 380, maxHeight: 460 }}>
          <div class="srow head"><span>Предмет</span><span>произв./мин</span><span>потр./мин</span></div>
          {rows.map((r) => (
            <button key={r.k} class={'srow' + (r.k === key ? ' on' : '')} onClick={() => setKey(r.k)}>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{r.k in ITEMS ? <ItemImg id={r.k} /> : <ResIcon name={r.k === 'compute' ? 'compute' : r.k === 'tokens' ? 'tokens' : r.k === 'data' ? 'data' : 'weights'} size={16} />}{label(r.k)}</span>
              <span class="mono pos">{fmt(r.p)}</span>
              <span class="mono neg">{fmt(r.c)}</span>
            </button>
          ))}
          {!rows.length && <div class="muted">Производства пока нет.</div>}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
            <b style={{ color: 'var(--text)' }}>{label(key)}</b>
            <span style={{ marginLeft: 'auto' }} />
            {([1, 10, 60] as const).map((s) => <button key={s} class={'btn small' + (scale === s ? ' primary' : '')} onClick={() => setScale(s)}>{s === 1 ? '1 мин' : s === 10 ? '10 мин' : '1 час'}</button>)}
          </div>
          <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ background: '#020b14', borderRadius: 8, border: '1px solid var(--line)' }}>
            {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="#0e2233" />)}
            <polyline points={pts(series.c)} fill="none" stroke="#ed5347" stroke-width="1.6" opacity="0.8" />
            <polyline points={pts(series.p)} fill="none" stroke="#33c0a7" stroke-width="2" />
            <text x="6" y="14" fill="#8a99a6" font-size="11" font-family="IBM Plex Mono">{fmt(max)} / {scale === 1 ? 'с' : scale === 10 ? '10 с' : 'мин'}</text>
          </svg>
          <div style={{ display: 'flex', gap: 14, fontSize: 12, marginTop: 6 }}>
            <span class="pos">■ произведено</span><span class="neg">■ потреблено</span>
            <span class="muted" style={{ marginLeft: 'auto' }}>Всего произведено: {fmt(sim.stats.totalProduced[key] ?? 0)}</span>
          </div>
        </div>
      </div>
    </Window>
  );
}

// ------------------------------------------------------------------ Codex
const SCRIPT_EXAMPLE = `class CopperRouter(Agent):
    every = 2          # запускать каждые 2 секунды
    def run(self):
        if self.power < 0.8:
            self.disable("chip_production")
        self.set_priority("batteries", 1)
        self.route("copper_ore", "smelter")

class NightShift(Agent):
    every = 5
    def run(self):
        if self.is_night:
            for b in self.buildings("all"):
                if b.type not in ["server", "datacenter"]:
                    self.disable(b)

class Hysteresis(Agent):
    saving = False     # поле класса — значение по умолчанию
    def run(self):
        if self.power < 0.6:
            self.saving = True
        elif self.power > 0.9:
            self.saving = False
        if self.saving:
            self.disable("labs")
`;

const API_DOC: [string, string][] = [
  ['self.power / self.energy', 'Доля обеспечения энергией 0..1 (мощность + запас аккумуляторов / номинальный спрос).'],
  ['self.time, self.is_night, self.day', 'Игровое время в секундах, ночь ли сейчас, номер дня.'],
  ['self.alerts', 'Список тревог: "low_energy", "enemies", "starved", "blocked".'],
  ['stock("item"), rate("item"), consumption("item")', 'Запас на складах; произведено и потреблено в минуту.'],
  ['buildings("group"), count("type")', 'Список зданий группы (у здания: type, name, status, working, idle, powered, recipe, x, y); число зданий.'],
  ['enable / disable / shutdown(group)', 'Включить/выключить группу. Действует, пока скрипт продолжает это вызывать.'],
  ['set_priority(group|item, 1..5)', 'Приоритет энергии: 1 — питается первым при дефиците.'],
  ['route(item, group)', 'Настраивает фильтры распределителей так, чтобы предмет шёл к группе.'],
  ['balance(item)', 'Распределители делят предмет поровну между выходами.'],
  ['set_recipe(group, item)', 'Переключает рецепт цехов группы.'],
  ['limit(item, max)', 'Цеха не начинают новый цикл, пока запас предмета ≥ max.'],
  ['notify(text, level)', 'Уведомление: info / warning / danger / success. "low_energy" — готовый текст.'],
  ['dispatch(drone, target)', 'Задание дронам: ("scout", "nearest_unknown"), ("combat", "enemies").'],
  ['build(blueprint, near)', 'Architect ставит параметрический чертёж, например build("microchip_line", "base").'],
  ['log(...)', 'Запись в лог агента (виден в вайб-панели).'],
];

const GROUP_DOC: [string, string][] = [
  ['smelter, assembler, chem, drills, labs, servers…', 'Все здания этого типа.'],
  ['<предмет>_production', 'Цеха, производящие предмет: chip_production, battery_production.'],
  ['<предмет>_smelters, <руда>_mining', 'Плавильни железа (iron_smelters), буры на меди (copper_mining).'],
  ['all', 'Все управляемые производственные здания.'],
  ['свои имена', 'Выделите здания рамкой → «Группа» → например line_b.'],
];

const HOTKEYS: [string, string][] = [
  ['WASD / стрелки / перетаскивание', 'Камера'], ['Колесо', 'Зум'], ['ЛКМ', 'Поставить / выбрать'], ['ПКМ', 'Снести / отменить инструмент'],
  ['R', 'Повернуть'], ['Q', 'Пипетка'], ['B', 'Строить'], ['M', 'Стратегическая карта'], ['Tab', 'Вайб-панель'], ['T', 'Исследования'],
  ['Alt', 'Оверлей рецептов и узких мест'], ['Пробел', 'Пауза'], ['1–4', 'Скорость ×1/×2/×4/×8'], ['F3', 'Оверлей производительности'],
  ['Ctrl+C / Ctrl+V', 'Копировать область в чертёж / вставить'], ['Esc', 'Закрыть / меню'], ['Delete', 'Снести выбранное'],
];

export function CodexWindow({ game }: { game: Game }) {
  const tab = game.ui.codexTab;
  const set = (t: string) => {
    game.ui.codexTab = t;
    game.emit();
  };
  const tabs: [string, string][] = [['buildings', 'Здания'], ['recipes', 'Рецепты'], ['script', 'FactoryScript'], ['agents', 'Агенты и эры'], ['keys', 'Управление']];
  return (
    <Window title="Кодекс" icon="codex" width={1080} onClose={() => { game.ui.panel = null; game.emit(); }}>
      <div class="buildmenu" style={{ position: 'static', transform: 'none', width: 'auto', minWidth: 0, padding: 0, background: 'none', border: 'none', boxShadow: 'none' }}>
        <div class="tabs">{tabs.map(([id, n]) => <button key={id} class={tab === id ? 'on' : ''} onClick={() => set(id)}>{n}</button>)}</div>
      </div>
      {tab === 'buildings' && (
        <div class="codex-grid">
          {BUILDING_LIST.filter((b) => !b.hidden).map((b) => (
            <div class="ccard" key={b.id}>
              <div style={{ display: 'flex', gap: 10 }}>
                {thumb('b', b.id) && <img src={thumb('b', b.id)} style={{ height: 54, maxWidth: 72, objectFit: 'contain' }} alt="" />}
                <div>
                  <b style={{ color: 'var(--text)' }}>{b.name}</b>
                  <div class="muted" style={{ fontSize: 11.5 }}>{CATEGORY_NAMES[b.category]} · {b.w}×{b.h}{b.power ? ` · ${mw(b.power)}` : ''}{b.gen ? ` · +${mw(b.gen)}` : ''}</div>
                </div>
              </div>
              <div style={{ fontSize: 12.5, marginTop: 6 }}>{b.desc}</div>
              <div class="cost" style={{ justifyContent: 'flex-start', marginTop: 6 }}>{b.cost.map((c) => <span key={c.item}><ItemImg id={c.item} size={14} />{c.n}</span>)}</div>
              {b.unlock && <div class="muted" style={{ fontSize: 11.5, marginTop: 4 }}>Исследование: {TECHS[b.unlock]?.name}</div>}
            </div>
          ))}
        </div>
      )}
      {tab === 'recipes' && (
        <div>
          {RECIPE_LIST.map((r) => (
            <div class="rrow" key={r.id}>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 220 }}><ItemImg id={r.outputs[0].item} size={22} /><b style={{ color: 'var(--text)' }}>{r.name}</b></span>
              <span class="inv">{r.inputs.map((i) => <span class="slot" key={i.item}><ItemImg id={i.item} />{i.n}</span>)}{r.fluid && <span class="slot"><ItemImg id="oil" />{r.fluid.n}</span>}{r.ai?.data && <span class="slot"><ResIcon name="data" size={16} />{r.ai.data}</span>}{r.ai?.weights && <span class="slot"><ResIcon name="weights" size={16} />{r.ai.weights}</span>}</span>
              <span class="muted">→ {r.outputs[0].n} за {r.time} с</span>
              <span class="muted" style={{ marginLeft: 'auto' }}>{r.machine === 'smelter' ? 'Плавильня' : r.machine === 'chem' ? 'Химзавод' : r.machine === 'assembler2' ? 'Сборочный цех II' : 'Сборочный цех'}</span>
            </div>
          ))}
          <div class="divider" />
          <div class="label">Ресурсы</div>
          <div class="inv" style={{ marginTop: 6 }}>{ITEM_LIST.map((it) => <span class="slot" key={it.id} data-tip={it.desc}><ItemImg id={it.id} />{it.name}</span>)}</div>
        </div>
      )}
      {tab === 'script' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <div style={{ fontSize: 13, marginBottom: 8 }}>FactoryScript — Python-подобный язык агентов. Каждый класс-агент запускается каждые <span class="mono">every</span> секунд (по умолчанию 1): методы <span class="mono">run</span> и <span class="mono">monitor</span>, а <span class="mono">on_event(self, name)</span> ловит события ("low_energy"). Бюджет: 500 операций на запуск (+250 за эру), каждая операция стоит вычислений.</div>
            <CodeView code={SCRIPT_EXAMPLE} maxHeight={520} />
          </div>
          <div>
            <div class="label" style={{ marginBottom: 6 }}>API</div>
            {API_DOC.map(([k, d]) => <div key={k} style={{ fontSize: 12.5, padding: '4px 0', borderBottom: '1px solid var(--line)' }}><span class="mono" style={{ color: 'var(--teal-soft)' }}>{k}</span><div class="muted">{d}</div></div>)}
            <div class="label" style={{ margin: '12px 0 6px' }}>Группы</div>
            {GROUP_DOC.map(([k, d]) => <div key={k} style={{ fontSize: 12.5, padding: '3px 0' }}><span class="mono" style={{ color: 'var(--cyan-soft)' }}>{k}</span> — <span class="muted">{d}</span></div>)}
          </div>
        </div>
      )}
      {tab === 'agents' && (
        <div>
          <div class="codex-grid">
            {(['terminal', ...HIRABLE] as const).map((r) => (
              <div class="ccard" key={r}><b style={{ color: ROLES[r].color }}>{ROLES[r].name}</b> <span class="tag" style={{ color: ROLES[r].color, marginLeft: 6 }}>{ROLES[r].tag}</span><div style={{ fontSize: 12.5, marginTop: 6 }}>{ROLES[r].desc}</div></div>
            ))}
          </div>
          <div class="divider" />
          {[1, 2, 3, 4].map((e) => <div key={e} style={{ fontSize: 13, padding: '4px 0' }}><b style={{ color: 'var(--text)' }}>{e}. {ERA_NAMES[e]}</b> <span class="muted">({ERA_SUB[e]})</span></div>)}
          <div class="muted" style={{ fontSize: 12.5, marginTop: 8 }}>Галлюцинации зависят от версии модели, заполнения контекста, техдолга и роли агента. Песочница и CI-тесты снимают техдолг; Debugger находит баги; Optimizer рефакторит.</div>
        </div>
      )}
      {tab === 'keys' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 24px' }}>
          {HOTKEYS.map(([k, d]) => <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '5px 0', borderBottom: '1px solid var(--line)' }}><span class="kbd">{k}</span><span>{d}</span></div>)}
        </div>
      )}
      {void RECIPES}{void BUILDINGS}
    </Window>
  );
}
