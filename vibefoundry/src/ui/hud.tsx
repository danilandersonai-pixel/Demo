import { useEffect, useRef, useState } from 'preact/hooks';
import type { Game } from '../game';
import { BUILDINGS, BUILDING_LIST, CATEGORY_NAMES, type BuildCategory } from '../data/buildings';
import { ITEMS, RESOURCE_NAMES, RES_BY_CODE, type ItemId } from '../data/items';
import { RECIPES, recipesFor } from '../data/recipes';
import { TECHS } from '../data/research';
import { BIOMES, isWater } from '../data/biomes';
import { QUEST_BY_ID } from '../data/quests';
import { STATUS_TEXT, type Entity } from '../sim/types';
import { mainPower } from '../sim/power';
import { contextCapacity, contextNeeded } from '../ai/context';
import { modelVersionLabel } from '../ai/state';
import { Icon, ResIcon } from './icons';
import { thumb } from './thumbs';
import { fmt, mw, pct, signed } from './format';
import { audio } from './audio';
import { CiPanel } from './overlays';

export function ItemImg({ id, size = 18 }: { id: string; size?: number }) {
  const t = thumb('i', id);
  return t ? <img src={t} width={size} height={size} style={{ imageRendering: 'auto' }} alt="" /> : <span style={{ width: size, height: size, display: 'inline-block' }} />;
}

export function itemName(id: string): string {
  return ITEMS[id as ItemId]?.name ?? id;
}

// ------------------------------------------------------------------ TopBar
export function TopBar({ game }: { game: Game }) {
  const sim = game.sim;
  const st = sim.stats;
  const net = mainPower(sim);
  let oil = 0;
  for (const n of sim.fluidNets) oil += n.amount;
  const res: { key: string; icon: string; name: string; value: string; delta: string; bad?: boolean; neg?: boolean; tip: string }[] = [
    { key: 'iron', icon: 'iron', name: 'Железо', value: fmt(sim.stock('iron_plate')), delta: `+${fmt(st.rate('iron_plate'))}/мин`, tip: 'Железные пластины на складах и производство в минуту' },
    { key: 'copper', icon: 'copper', name: 'Медь', value: fmt(sim.stock('copper_plate')), delta: `+${fmt(st.rate('copper_plate'))}/мин`, tip: 'Медные пластины на складах' },
    { key: 'silicon', icon: 'silicon', name: 'Кремний', value: fmt(sim.stock('silicon_wafer')), delta: `+${fmt(st.rate('silicon_wafer'))}/мин`, tip: 'Кремниевые пластины на складах' },
    { key: 'oil', icon: 'oil', name: 'Нефть', value: fmt(oil), delta: `+${fmt(st.rate('oil'))}/мин`, tip: 'Нефть в трубах' },
    { key: 'uranium', icon: 'uranium', name: 'Уран', value: fmt(sim.stock('uranium_ore')), delta: `+${fmt(st.rate('uranium_ore'))}/мин`, tip: 'Урановая руда на складах' },
    {
      key: 'energy', icon: 'energy', name: 'Энергия', value: mw(net.used), delta: `${net.capacity - net.demand >= 0 ? '+' : '−'}${mw(Math.abs(net.capacity - net.demand))}`,
      bad: net.sat < 0.999, neg: net.capacity < net.demand, tip: `Потребление / запас мощности. Мощность ${mw(net.capacity)}, спрос ${mw(net.demand)}. Удовлетворение ${pct(net.sat)}.`,
    },
    { key: 'compute', icon: 'compute', name: 'Вычисления', value: fmt(sim.ai.compute), delta: signed(st.rate('compute') - st.consumeRate('compute')) + '/мин', neg: st.rate('compute') < st.consumeRate('compute'), tip: 'Вычисления: работа агентов, операции скриптов, обучение' },
    { key: 'tokens', icon: 'tokens', name: 'Токены', value: fmt(sim.ai.tokens), delta: signed(st.rate('tokens') - st.consumeRate('tokens')) + '/мин', neg: st.rate('tokens') < st.consumeRate('tokens'), tip: 'Токены: валюта запросов к ИИ' },
    { key: 'context', icon: 'context', name: 'Контекст', value: `${fmt(contextNeeded(sim))}/${fmt(contextCapacity(sim))}k`, delta: `модель ${modelVersionLabel(sim.ai)}`, bad: contextNeeded(sim) > contextCapacity(sim), tip: 'Сколько фабрики «видит» ИИ: нужно / ёмкость. Переполнение → больше галлюцинаций.' },
  ];
  const night = sim.isNight;
  const sp = game.paused ? 0 : game.speed;
  return (
    <div class="topbar">
      <div class="panel logo" data-tip="VibeFoundry — Build · Automate · Vibe Code · Repeat">
        <svg class="v" width="26" height="26" viewBox="0 0 32 32"><path d="M3 6h7.5l5.5 14 5.5-14H29L19.5 28h-7z" fill="#32C6F4" /><path d="M12.5 6h7L16 15z" fill="#0A4A7A" /></svg>
        VibeFoundry
      </div>
      <div class="res-strip">
        {res.map((r) => (
          <div class={'panel res' + (r.bad ? ' bad' : '')} key={r.key} data-tip={r.tip}>
            <ResIcon name={r.icon} size={26} />
            <div>
              <div class="t">{r.name}</div>
              <div class="v">{r.value}</div>
              <div class={'d' + (r.neg ? ' neg' : '')}>{r.delta}</div>
            </div>
          </div>
        ))}
      </div>
      <div class="panel clock">
        <span style={{ color: night ? '#9096db' : '#edbb5a' }}><Icon name={night ? 'moon' : 'sun'} size={26} /></span>
        <div>
          <div class="day">День {sim.day}</div>
          <div class="time">{sim.clockText()}</div>
        </div>
        <div class="speed">
          <button class={sp === 0 ? 'on' : ''} onClick={() => game.setSpeed(0)} data-tip="Пауза (Пробел)"><Icon name="pause" size={18} /></button>
          <button class={sp === 1 ? 'on' : ''} onClick={() => game.setSpeed(1)} data-tip="Скорость ×1 (1)"><Icon name="play" size={18} /></button>
          <button class={sp === 2 ? 'on' : ''} onClick={() => game.setSpeed(2)} data-tip="Скорость ×2 (2)"><Icon name="fast" size={18} /></button>
          <button class={sp >= 4 ? 'on' : ''} onClick={() => game.setSpeed(4)} data-tip="Скорость ×4 (3), ×8 — клавиша 4"><Icon name="faster" size={18} /></button>
        </div>
      </div>
      <button class="panel icon-btn" style={{ width: 60, height: 60 }} onClick={() => game.togglePanel('settings')} data-tip="Настройки"><Icon name="settings" size={24} /></button>
    </div>
  );
}

// ------------------------------------------------------------------ Quests
export function Quests({ game }: { game: Game }) {
  const sim = game.sim;
  const active = sim.quests.active.map((id) => QUEST_BY_ID[id]).filter(Boolean);
  if (!active.length) return null;
  return (
    <div class="panel quests">
      <div class="hdr"><span style={{ color: 'var(--teal)' }}><Icon name="home" size={18} /></span> Задачи <span class="muted mono" style={{ marginLeft: 'auto', fontSize: 11 }}>{sim.quests.done.length}/30</span></div>
      {active.map((q, i) => {
        const [cur, max] = q.progress(sim);
        return (
          <div class={'quest' + (i === 0 ? ' first' : '')} key={q.id}>
            <div class="ic">{i === 0 ? <Icon name="check" size={13} /> : null}</div>
            <div>
              <div class="tt">{q.title}</div>
              <div class="ds">{q.desc}</div>
              {max > 1 && <div class="pr">({fmt(cur)}/{fmt(max)})</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ Minimap
export function Minimap({ game }: { game: Game }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const base = useRef<HTMLCanvasElement | null>(null);
  const lastBase = useRef(0);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const sim = game.sim;
    const W = sim.world.w;
    const now = performance.now();
    if (!base.current || now - lastBase.current > 2500 || (base.current as any).__sim !== sim) {
      lastBase.current = now;
      const b = base.current ?? document.createElement('canvas');
      (b as any).__sim = sim;
      b.width = W * 2;
      b.height = W;
      const ctx = b.getContext('2d')!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#052b40';
      ctx.fillRect(0, 0, b.width, b.height);
      ctx.setTransform(1, 0.5, -1, 0.5, W, 0);
      const img = sim.world;
      for (let y = 0; y < W; y += 1) {
        for (let x = 0; x < W; x += 1) {
          const i = y * W + x;
          const bi = img.biome[i];
          if (bi === 0) continue;
          let c = BIOMES[bi].map;
          if (!img.fog[i]) c = 0x0b1826;
          else if (img.res[i] && img.amt[i] > 0) c = 0xb09a80;
          ctx.fillStyle = '#' + c.toString(16).padStart(6, '0');
          ctx.fillRect(x, y, 1.1, 1.1);
        }
      }
      base.current = b;
    }
    cv.width = cv.clientWidth * 2;
    cv.height = cv.clientHeight * 2;
    const ctx = cv.getContext('2d')!;
    const s = Math.min(cv.width / (W * 2), cv.height / W);
    const ox = (cv.width - W * 2 * s) / 2;
    const oy = (cv.height - W * s) / 2;
    ctx.fillStyle = '#031d2e';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(base.current!, ox, oy, W * 2 * s, W * s);
    const P = (x: number, y: number): [number, number] => [ox + (x - y + W) * s, oy + ((x + y) / 2) * s];
    // buildings
    ctx.fillStyle = '#66d8ff';
    for (const e of sim.list) {
      if (e.ghost || e.type === 'belt' || e.type === 'pipe' || e.type === 'pole') continue;
      const [x, y] = P(e.x + e.w / 2, e.y + e.h / 2);
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    // POIs
    ctx.fillStyle = '#edbb5a';
    for (const p of sim.world.pois) if (!p.explored) {
      const [x, y] = P(p.x, p.y);
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ed5347';
    for (const en of sim.enemies) {
      const [x, y] = P(en.x, en.y);
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }
    // base marker
    const [bx, by] = P(sim.world.base.x, sim.world.base.y);
    ctx.fillStyle = '#32c6f4';
    ctx.beginPath();
    ctx.arc(bx, by, 4, 0, Math.PI * 2);
    ctx.fill();
    // view rectangle
    const corners = game.renderer.viewCorners();
    ctx.strokeStyle = '#f2f8fc';
    ctx.lineWidth = 2;
    ctx.beginPath();
    corners.forEach((c, i) => {
      const [x, y] = P(c.x, c.y);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
    (cv as any).__map = { s, ox, oy, W };
  });
  const onClick = (ev: MouseEvent) => {
    const cv = ref.current!;
    const m = (cv as any).__map;
    if (!m) return;
    const r = cv.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * cv.width;
    const py = ((ev.clientY - r.top) / r.height) * cv.height;
    // invert P: a = x - y + W, b = (x + y)/2
    const a = (px - m.ox) / m.s - m.W;
    const b = ((py - m.oy) / m.s) * 2;
    const x = (a + b) / 2;
    const y = (b - a) / 2;
    game.renderer.flyTo(x, y);
  };
  return (
    <div class="panel minimap">
      <canvas ref={ref} onClick={onClick} data-tip="Мини-карта: клик — перелёт камеры" />
      <div class="side">
        <span class="compass" data-tip="Север — вверху"><Icon name="compass" size={22} /></span>
        <button onClick={() => game.renderer.zoomAt(1.25, game.renderer.screenW / 2, game.renderer.screenH / 2)} data-tip="Приблизить"><Icon name="plus" size={16} /></button>
        <button onClick={() => game.renderer.zoomAt(0.8, game.renderer.screenW / 2, game.renderer.screenH / 2)} data-tip="Отдалить"><Icon name="minus" size={16} /></button>
        <button onClick={() => game.togglePanel('map')} data-tip="Стратегическая карта (M)"><Icon name="map" size={16} /></button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Toasts
export function Toasts({ game }: { game: Game }) {
  return (
    <div class="toasts">
      {game.ui.toasts.map((t) => (
        <div class={'toast ' + t.kind} key={t.id}>
          <span class="i"><Icon name={t.kind === 'warning' ? 'alert' : t.kind === 'info' ? 'info' : t.kind === 'success' ? 'success' : 'danger'} size={22} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div class="tt">{t.title}</div>
            {t.text && <div class="tx">{t.text}</div>}
            {(t.focus || t.action) && (
              <div class="acts">
                {t.focus && <button class="btn small" onClick={() => { game.focusTile(t.focus!.x, t.focus!.y); game.dismissToast(t.id); }}><Icon name="eye" size={14} />Показать</button>}
                {t.action && <button class="btn small primary" onClick={() => { game.command(t.action!.cmd, t.action!.arg); game.dismissToast(t.id); }}>{t.action.label}</button>}
              </div>
            )}
          </div>
          <button class="xbtn" style={{ width: 24, height: 24, border: 'none' }} onClick={() => game.dismissToast(t.id)}><Icon name="close" size={14} /></button>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Toolbar
const TOOLS: { id: string; icon: string; name: string; panel: any; key: string }[] = [
  { id: 'tool-build', icon: 'build', name: 'Строить', panel: 'build', key: 'B' },
  { id: 'tool-map', icon: 'map', name: 'Карта', panel: 'map', key: 'M' },
  { id: 'tool-drones', icon: 'drone', name: 'Логистика и дроны', panel: 'drones', key: '' },
  { id: 'tool-stats', icon: 'stats', name: 'Статистика', panel: 'stats', key: '' },
  { id: 'tool-research', icon: 'research', name: 'Исследования', panel: 'research', key: 'T' },
  { id: 'tool-agents', icon: 'agents', name: 'Агенты', panel: 'agents', key: '' },
  { id: 'tool-vibe', icon: 'code', name: 'Код — вайб-кодинг', panel: 'vibe', key: 'Tab' },
  { id: 'tool-codex', icon: 'codex', name: 'Кодекс', panel: 'codex', key: '' },
];

export function Toolbar({ game }: { game: Game }) {
  const hl = tutorialTarget(game);
  return (
    <div class="panel toolbar">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          id={t.id}
          class={'icon-btn' + (game.ui.panel === t.panel ? ' active' : '') + (hl === t.id && game.ui.panel !== t.panel ? ' pulse-target' : '')}
          onClick={() => game.togglePanel(t.panel)}
          data-tip={t.name + (t.key ? ` (${t.key})` : '')}
          aria-label={t.name}
        >
          <Icon name={t.icon} size={24} />
          {t.key && <span class="k">{t.key}</span>}
        </button>
      ))}
    </div>
  );
}

export function tutorialTarget(game: Game): string | null {
  const first = game.sim.quests.active[0];
  const q = first ? QUEST_BY_ID[first] : null;
  if (!q || !q.highlight) return null;
  if (game.sim.time > 60 * 40 && q.era === 1) return null;
  return q.highlight;
}

// ------------------------------------------------------------------ Build menu
const CATS: BuildCategory[] = ['logistics', 'mining', 'production', 'power', 'ai', 'drones', 'colony'];

export function BuildMenu({ game }: { game: Game }) {
  const sim = game.sim;
  const cat = game.ui.buildCategory as BuildCategory;
  const list = BUILDING_LIST.filter((b) => !b.hidden && b.category === cat);
  const cur = game.tool.kind === 'build' ? game.tool.type : null;
  const stock = sim.stockAll();
  const q = sim.quests.active[0];
  const hlCard = q === 'q_drill' ? 'drill' : q === 'q_belt' ? 'belt' : q === 'q_power' ? 'pole' : q === 'q_lab' ? 'lab' : null;
  return (
    <div class="panel glow buildmenu">
      <div class="tabs">
        {CATS.map((c) => (
          <button key={c} class={c === cat ? 'on' : ''} onClick={() => { game.ui.buildCategory = c; game.emit(); }}>{CATEGORY_NAMES[c]}</button>
        ))}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <button class={game.tool.kind === 'decon' ? 'on' : ''} onClick={() => { game.setTool(game.tool.kind === 'decon' ? { kind: 'none' } : { kind: 'decon' }); game.ui.panel = null; game.emit(); }} data-tip="Снос рамкой: выделите область"><Icon name="trash" size={14} /> Снос</button>
          <button class={game.tool.kind === 'group' ? 'on' : ''} onClick={() => { game.setTool(game.tool.kind === 'group' ? { kind: 'none' } : { kind: 'group' }); game.ui.panel = null; game.emit(); }} data-tip="Группа рамкой (G): выделите здания → имя группы для скриптов"><Icon name="group" size={14} /> Группа</button>
          {sim.isUnlocked('blueprints') && <button class={game.tool.kind === 'copy' ? 'on' : ''} onClick={() => { game.setTool({ kind: 'copy' }); game.ui.panel = null; game.emit(); }} data-tip="Чертёж (Ctrl+C): скопировать область"><Icon name="copy" size={14} /> Чертёж</button>}
        </span>
      </div>
      <div class="muted" style={{ fontSize: 11.5, margin: '-4px 0 8px' }}>
        <span class="kbd">R</span> поворот · <span class="kbd">Q</span> пипетка · <span class="kbd">ПКМ</span> снос · ленты и трубы тянутся мышью
      </div>
      <div class="bgrid scroll">
        {list.map((b) => {
          const unlocked = sim.isUnlocked(b.unlock);
          const t = thumb('b', b.id);
          return (
            <button
              key={b.id}
              class={'bcard' + (cur === b.id ? ' on' : '') + (!unlocked ? ' locked' : '') + (hlCard === b.id && cur !== b.id ? ' pulse-target' : '')}
              onClick={() => { if (unlocked) { game.selectBuild(b.id); audio.play('click'); } }}
              aria-label={b.name}
              data-tip={`${b.name}. ${b.desc}${b.power ? ` Потребление: ${mw(b.power)}.` : ''}${b.gen ? ` Выработка: ${mw(b.gen)}.` : ''} Размер ${b.w}×${b.h}.${!unlocked ? ` Требуется: ${TECHS[b.unlock!]?.name}.` : ''}`}
            >
              {t ? <img src={t} alt="" /> : <div style={{ height: 58 }} />}
              <div class="nm">{b.name}</div>
              {unlocked ? (
                <div class="cost">
                  {b.cost.map((c) => (
                    <span key={c.item} class={(stock[c.item] ?? 0) < c.n ? 'lack' : ''}><ItemImg id={c.item} size={14} />{c.n}</span>
                  ))}
                </div>
              ) : (
                <div class="cost"><span><Icon name="lock" size={12} /> {TECHS[b.unlock!]?.name}</span></div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Tool hint
export function ToolHint({ game }: { game: Game }) {
  const t = game.tool;
  if (t.kind === 'none' || game.ui.panel === 'build') return null;
  let text = '';
  if (t.kind === 'build') text = `Строим: ${BUILDINGS[t.type].name}. ЛКМ — поставить${t.type === 'belt' || t.type === 'pipe' ? ' (тяните линию)' : ''}, R — поворот, Esc — отмена`;
  if (t.kind === 'decon') text = 'Снос: выделите область мышью. Esc — отмена';
  if (t.kind === 'group') text = 'Группа: выделите здания рамкой — получится именованная группа для скриптов';
  if (t.kind === 'copy') text = 'Чертёж: выделите область для копирования';
  if (t.kind === 'paste') text = `Вставка чертежа «${t.bp.name}»: ЛКМ — поставить призраки, Esc — отмена`;
  return (
    <div class="panel tool-hint">
      <span style={{ color: 'var(--cyan)' }}><Icon name={t.kind === 'decon' ? 'trash' : t.kind === 'group' ? 'group' : 'build'} size={18} /></span>
      {text}
      <button class="btn small" onClick={() => game.setTool({ kind: 'none' })}>Отмена</button>
    </div>
  );
}

// ------------------------------------------------------------------ Info panel
const STATUS_COLOR: Record<string, string> = {
  working: 'var(--teal)', idle: 'var(--muted)', no_input: 'var(--amber)', output_full: 'var(--amber)', no_power: 'var(--red)', low_power: 'var(--amber)',
  disabled: 'var(--muted)', no_recipe: 'var(--amber)', limit: 'var(--cyan)', no_fluid: 'var(--red)', no_resource: 'var(--red)', no_materials: 'var(--amber)',
  out_of_range: 'var(--red)', waiting: 'var(--cyan)', no_cooling: 'var(--amber)', no_research: 'var(--amber)',
};

export function InfoPanel({ game }: { game: Game }) {
  const e = game.selected();
  if (e) return <BuildingInfo game={game} e={e} />;
  const f = game.ui.focusTile;
  if (!f) return null;
  return <TileInfo game={game} x={f.x} y={f.y} />;
}

function TileInfo({ game, x, y }: { game: Game; x: number; y: number }) {
  const w = game.sim.world;
  if (!w.inBounds(x, y)) return null;
  const i = w.idx(x, y);
  const revealed = w.fog[i] === 1;
  const b = BIOMES[w.biome[i]];
  const res = w.res[i] && w.amt[i] > 0 ? RES_BY_CODE[w.res[i]] : null;
  const poi = w.pois.find((p) => Math.abs(p.x - x) <= 1 && Math.abs(p.y - y) <= 1 && !p.explored);
  const t = thumb('t', String(b.id));
  const hints = Object.entries(b.hints);
  return (
    <div class="panel info">
      <div class="top">
        <div class="thumb">{t && revealed ? <img src={t} alt="" /> : <Icon name="question" size={28} />}</div>
        <div style={{ minWidth: 0 }}>
          <div class="h2" style={{ fontFamily: 'var(--font-display)', fontSize: 18 }}>{revealed ? b.name : 'Неизвестная область'}</div>
          <div class="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{revealed ? b.desc : 'Туман войны. Откройте территорию стройкой, радаром или дронами-разведчиками.'}</div>
        </div>
      </div>
      {revealed && (
        <>
          <div class="divider" />
          <div class="label" style={{ marginBottom: 4 }}>Ресурсы</div>
          {res && (
            <div class="row"><span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><ItemImg id={res} />{RESOURCE_NAMES[res]} — месторождение</span><span class="mono pos">{fmt(w.amt[i])}</span></div>
          )}
          {hints.map(([r, lvl]) => (
            <div class="row" key={r}><span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><ItemImg id={r} />{RESOURCE_NAMES[r as keyof typeof RESOURCE_NAMES]}</span><span class={lvl === 'Высокое' ? 'pos' : lvl === 'Среднее' ? '' : 'muted'}>{lvl}</span></div>
          ))}
          {!hints.length && !res && <div class="muted" style={{ fontSize: 12.5 }}>Ресурсов нет.</div>}
          <div class="divider" />
          <div style={{ display: 'flex', gap: 8, fontSize: 12.5 }}><span style={{ color: 'var(--cyan)' }}><Icon name="info" size={16} /></span><span>{isWater(b.id) ? b.recommend : poi ? 'Здесь неизвестная точка: отправьте дрона в экспедицию.' : b.recommend}</span></div>
          {poi && (
            <button class="btn primary" style={{ marginTop: 8 }} onClick={() => game.command('explorePoi', poi.id)}>
              <Icon name="drone" size={16} /> Отправить дрона в экспедицию
            </button>
          )}
        </>
      )}
    </div>
  );
}

function BuildingInfo({ game, e }: { game: Game; e: Entity }) {
  const sim = game.sim;
  const def = BUILDINGS[e.type];
  const t = thumb('b', e.type);
  const st = e.ghost ? (e.status ?? 'waiting') : e.status ?? 'idle';
  const r = e.recipe ? RECIPES[e.recipe] : undefined;
  const groups = Object.entries(sim.groups).filter(([, ids]) => ids.includes(e.id)).map(([g]) => g);
  const scripts = sim.scripts.controllers(e.id);
  const recipes = def.machine ? recipesFor(def.machine).filter((rr) => sim.isUnlocked(rr.unlock) && (def.machine !== 'smelter')) : [];
  const setRecipe = (id: string) => {
    for (const bag of [e.inv, e.out]) if (bag) for (const k in bag) { if (bag[k] > 0) sim.addStock(k, bag[k]); bag[k] = 0; }
    e.recipe = id || null;
    e.crafting = false;
    e.progress = 0;
    sim.noteManual();
    game.emit();
  };
  const inv = (bag?: Record<string, number>) => Object.entries(bag ?? {}).filter(([, n]) => n > 0);
  const hpFrac = e.hp / def.hp;
  return (
    <div class="panel info glow">
      <div class="top">
        <div class="thumb">{t && <img src={t} alt="" />}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div class="h2" style={{ fontFamily: 'var(--font-display)', fontSize: 18 }}>{def.name}{e.ghost ? ' (призрак)' : ''}</div>
          <div style={{ marginTop: 4, fontSize: 13 }}>
            <span class="status-dot" style={{ background: STATUS_COLOR[st] ?? 'var(--muted)' }} />
            {e.decon ? 'Помечено на снос' : STATUS_TEXT[st as keyof typeof STATUS_TEXT] ?? st}
          </div>
          {!e.ghost && hpFrac < 0.999 && <div class="bar" style={{ marginTop: 6 }}><i style={{ width: pct(hpFrac), background: hpFrac < 0.4 ? 'var(--red)' : 'var(--amber)' }} /></div>}
        </div>
        <button class="xbtn" onClick={() => game.select(null)}><Icon name="close" size={16} /></button>
      </div>
      <div class="divider" />
      <div class="scroll" style={{ minHeight: 0, flex: 1 }}>
        {def.power > 0 && !e.ghost && (
          <div class="row"><span class="muted">Энергия</span><span class="mono">{mw((e.wantPower ?? 0) * (e.sat ?? 0))} / {mw(def.power)} · {pct(e.sat ?? 0)}</span></div>
        )}
        {def.gen && !e.ghost && <div class="row"><span class="muted">Выработка</span><span class="mono pos">{mw(e.wantPower ?? 0)}</span></div>}
        {e.type === 'accumulator' && <div class="row"><span class="muted">Заряд</span><span class="mono">{fmt((e.charge ?? 0) / 1000, 2)} / 5 MJ</span></div>}
        {e.type === 'drill' && e.recipe && <div class="row"><span class="muted">Добывает</span><span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><ItemImg id={e.recipe} />{itemName(e.recipe)}</span></div>}
        {def.machine && def.machine !== 'smelter' && !e.ghost && (
          <div class="row">
            <span class="muted">Рецепт</span>
            <select value={e.recipe ?? ''} onChange={(ev) => setRecipe((ev.target as HTMLSelectElement).value)} style={{ padding: '4px 6px', maxWidth: 190 }}>
              <option value="">— выберите —</option>
              {recipes.map((rr) => <option key={rr.id} value={rr.id}>{rr.name}</option>)}
            </select>
          </div>
        )}
        {e.type === 'smelter' && <div class="row"><span class="muted">Рецепт</span><span>{r ? r.name : 'по входу (авто)'}</span></div>}
        {r && (
          <>
            <div class="row"><span class="muted">Цикл</span><span class="mono">{r.inputs.map((s) => `${s.n} ${itemName(s.item).toLowerCase()}`).join(' + ') || (r.fluid ? `${r.fluid.n} нефти` : '')}{r.fluid && r.inputs.length ? ` + ${r.fluid.n} нефти` : ''} → {r.outputs.map((o) => `${o.n}`).join('')}, {fmt(r.time / (def.speed ?? 1), 1)} с</span></div>
            <div class="bar" style={{ margin: '6px 0' }}><i style={{ width: pct(e.progress ?? 0) }} /></div>
          </>
        )}
        {e.type === 'lab' && <div class="row"><span class="muted">Исследует</span><span>{sim.research.current ? TECHS[sim.research.current].name : '—'}</span></div>}
        {inv(e.inv).length > 0 && <div class="row"><span class="muted">Вход</span><span class="inv">{inv(e.inv).map(([k, n]) => <span class="slot" key={k}><ItemImg id={k} />{n}</span>)}</span></div>}
        {inv(e.out).length > 0 && <div class="row"><span class="muted">Выход</span><span class="inv">{inv(e.out).map(([k, n]) => <span class="slot" key={k}><ItemImg id={k} />{n}</span>)}</span></div>}
        {e.store && (
          <div style={{ padding: '6px 0' }}>
            <div class="label" style={{ marginBottom: 6 }}>Склад · {fmt(e.storeTotal ?? 0)} / {fmt(def.storage ?? 0)}</div>
            <div class="inv">{inv(e.store).sort((a, b) => b[1] - a[1]).map(([k, n]) => <span class="slot" key={k} data-tip={itemName(k)}><ItemImg id={k} />{fmt(n)}</span>)}</div>
          </div>
        )}
        {(e.type === 'aicore' || e.type === 'server') && !e.ghost && (
          <div class="row">
            <span class="muted">Модули памяти</span>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span class="mono">{e.modules ?? 0}/{e.type === 'aicore' ? 20 : 4}</span>
              <button class="btn small" disabled={sim.stock('memory_module') < 1} onClick={() => game.command('installModule', e.id)}>Установить</button>
            </span>
          </div>
        )}
        {e.type === 'inserter' && !e.ghost && (
          <div class="row">
            <span class="muted">Фильтр</span>
            <select value={e.filter ?? ''} onChange={(ev) => { e.filter = (ev.target as HTMLSelectElement).value || null; game.emit(); }} style={{ padding: '4px 6px', maxWidth: 190 }}>
              <option value="">любой нужный</option>
              {Object.values(ITEMS).filter((it) => !it.fluid).map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
            </select>
          </div>
        )}
        {e.type === 'ci' && !e.ghost && <CiPanel game={game} />}
        {groups.length > 0 && <div class="row"><span class="muted">Группы</span><span class="inv">{groups.map((g) => <span class="chip mono" key={g}>{g}</span>)}</span></div>}
        {scripts.length > 0 && (
          <div class="row">
            <span class="muted">Управляет</span>
            <span class="inv">{scripts.map((s) => <button class="chip mono" key={s} style={{ color: 'var(--cyan-soft)' }} onClick={() => game.togglePanel('git')}>{s}</button>)}</span>
          </div>
        )}
        {(e.scriptOff || e.scriptPrio !== undefined) && <div class="row"><span class="muted">Скрипт</span><span class="warn">{e.scriptOff ? 'отключил здание' : ''}{e.scriptPrio !== undefined ? ` приоритет ${e.scriptPrio}` : ''}</span></div>}
      </div>
      {!e.ghost && e.type !== 'hq' && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {def.power > 0 && (
            <button class={'btn small' + (e.off ? ' bad' : '')} onClick={() => { e.off = !e.off; sim.noteManual(); game.emit(); }} data-tip="Ручное включение/выключение">
              <Icon name="power" size={14} />{e.off ? 'Выключено' : 'Включено'}
            </button>
          )}
          {def.power > 0 && (
            <select value={String(e.prio ?? 3)} onChange={(ev) => { e.prio = Number((ev.target as HTMLSelectElement).value); sim.noteManual(); game.emit(); }} data-tip="Приоритет энергии: 1 — высший" style={{ padding: '3px 6px' }}>
              {[1, 2, 3, 4, 5].map((p) => <option key={p} value={p}>Приоритет {p}</option>)}
            </select>
          )}
          {def.rotatable && <button class="btn small" onClick={() => { sim.rotate(e); game.emit(); }}><Icon name="rotate" size={14} />R</button>}
          <button class="btn small" onClick={() => { game.ui.pendingGroup = [e.id]; game.emit(); }} data-tip="Добавить в именованную группу для скриптов"><Icon name="group" size={14} />Группа</button>
          <button class="btn small bad" onClick={() => game.deconstructAt(e.x, e.y)} data-tip="Снести (ПКМ)"><Icon name="trash" size={14} /></button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Coordinates
export function CoordPanel({ game }: { game: Game }) {
  const h = game.ui.focusTile ?? game.ui.hover;
  if (!h) return null;
  const w = game.sim.world;
  if (!w.inBounds(h.x, h.y)) return null;
  const b = BIOMES[w.biome[w.idx(h.x, h.y)]];
  const revealed = w.isRevealed(h.x, h.y);
  const t = thumb('t', String(b.id));
  return (
    <div class="panel coord">
      <div class="thumb">{t && revealed ? <img src={t} style={{ width: '100%' }} alt="" /> : <Icon name="question" size={24} />}</div>
      <div>
        <div class="h2" style={{ fontSize: 15 }}>{revealed ? b.name : 'Неизвестно'}</div>
        <div class="mono" style={{ fontSize: 13, marginTop: 4 }}>X: {h.x} &nbsp;Y: {h.y}</div>
        <button class="btn small" style={{ marginTop: 8 }} disabled={!revealed || isWater(b.id)} onClick={() => { game.ui.focusTile = { x: h.x, y: h.y }; game.renderer.flyTo(h.x, h.y); game.ui.panel = 'build'; game.emit(); }}>
          Построить здесь
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Perf
export function PerfOverlay({ game }: { game: Game }) {
  if (!game.ui.showPerf) return null;
  const p = game.perf;
  const sim = game.sim;
  const items = sim.belts.totalItems();
  return (
    <div class="panel perf pass">
      <span>FPS {p.fps}</span>
      <span>UPS {p.ups}</span>
      <span>тик {p.tickMs.toFixed(2)} мс</span>
      <span>кадр {p.frameMs.toFixed(1)} мс</span>
      <span>сущностей {sim.list.length}</span>
      <span>предметов {items}</span>
      <span>дронов {sim.drones.length}</span>
      <span>оп. скриптов {sim.scripts.opsLastSecond}</span>
    </div>
  );
}

/** Group naming prompt after a group selection. */
export function GroupPrompt({ game }: { game: Game }) {
  const ids = game.ui.pendingGroup;
  const [name, setName] = useState('');
  if (!ids) return null;
  const existing = Object.keys(game.sim.groups);
  const save = (n: string) => {
    const nm = n.trim().toLowerCase().replace(/[^a-z0-9_а-яё]+/gi, '_').replace(/^_+|_+$/g, '');
    if (!nm) return;
    const arr = game.sim.groups[nm] ?? [];
    for (const id of ids) if (!arr.includes(id)) arr.push(id);
    game.sim.groups[nm] = arr;
    game.ui.pendingGroup = null;
    game.pushToast({ kind: 'success', title: `Группа «${nm}»`, text: `${arr.length} зданий. Используйте в скриптах: self.disable("${nm}")` });
    setName('');
  };
  return (
    <div class="panel glow" style={{ position: 'absolute', top: '40%', left: '50%', transform: 'translate(-50%,-50%)', padding: 16, width: 380 }}>
      <div class="h2">Создать группу ({ids.length} зд.)</div>
      <div class="muted" style={{ fontSize: 12.5, margin: '6px 0 10px' }}>Имя латиницей, например chip_production, smelter_line, line_b.</div>
      <input autoFocus value={name} onInput={(ev) => setName((ev.target as HTMLInputElement).value)} onKeyDown={(ev) => ev.key === 'Enter' && save(name)} placeholder="line_b" style={{ width: '100%', padding: '8px 10px' }} />
      {existing.length > 0 && (
        <div class="inv" style={{ marginTop: 8 }}>
          {existing.map((g) => <button class="chip mono" key={g} onClick={() => save(g)}>+ {g}</button>)}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
        <button class="btn" onClick={() => { game.ui.pendingGroup = null; game.emit(); }}>Отмена</button>
        <button class="btn primary" onClick={() => save(name)}>Создать</button>
      </div>
    </div>
  );
}
