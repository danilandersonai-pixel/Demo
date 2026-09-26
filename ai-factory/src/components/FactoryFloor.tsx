import { AnimatePresence, motion } from 'framer-motion';
import { Bug, Lock, Move, Plus, Zap } from 'lucide-react';
import { memo, useMemo } from 'react';
import { BUILDINGS, COLS, FEEDS, GRID, LINK_COLORS, LINK_RES } from '../game/config';
import { money, num, pct, roman } from '../game/format';
import { cellMap, cellName, cellsOf, isCellOpen, occupiedCells, openCellCount, serialOf } from '../game/selectors';
import type { Building, BuildingFlow, GameState, LinkRes, Status } from '../game/types';
import { BUILDING_ICONS } from '../ui/icons';
import { Panel } from '../ui/primitives';

export const STATUS_COLOR: Record<Status, string> = {
  working: '#34d399',
  partial: '#facc15',
  idle: '#fb923c',
  blocked: '#fb923c',
  nopower: '#f43f5e',
  paused: '#6b7788',
};

export const STATUS_LABEL: Record<Status, string> = {
  working: 'Работает',
  partial: 'Неполная загрузка',
  idle: 'Простой',
  blocked: 'Выход заблокирован',
  nopower: 'Нет питания',
  paused: 'Остановлен',
};

/** Доля клетки, на которую плитка отступает от края: в зазоре видны ленты. */
const INSET = 0.12;

interface Link {
  key: string;
  res: LinkRes;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  active: boolean;
}

function buildLinks(state: GameState): Link[] {
  const map = cellMap(state);
  const links: Link[] = [];
  for (const b of state.buildings) {
    const feeds = FEEDS[b.type];
    if (!feeds) continue;
    for (const [cx, cy] of cellsOf(b)) {
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
        const j = map[ny * GRID + nx];
        if (j < 0) continue;
        const src = state.buildings[j];
        if (src.id === b.id || !feeds.includes(src.type)) continue;
        const res = LINK_RES[src.type];
        if (!res) continue;
        const fs = state.flow.b[src.id];
        const fb = state.flow.b[b.id];
        links.push({
          key: `${src.id}>${b.id}@${cx},${cy}`,
          res,
          // Отрезок от края плитки-поставщика до края плитки-потребителя.
          x1: nx + 0.5 + dx * -(0.5 - INSET) * 0.8,
          y1: ny + 0.5 + dy * -(0.5 - INSET) * 0.8,
          x2: cx + 0.5 + dx * (0.5 - INSET) * 0.8,
          y2: cy + 0.5 + dy * (0.5 - INSET) * 0.8,
          active: src.enabled && b.enabled && (fs?.u ?? 0) > 0.01 && (fb?.u ?? 0) > 0.01,
        });
      }
    }
  }
  return links;
}

/** Статичный слой лент: перерисовывается только при изменении связей. */
const Belts = memo(function Belts({ links }: { links: Link[] }) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-[1] h-full w-full"
      viewBox={`0 0 ${GRID} ${GRID}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      {links.map((l) => {
        const c = LINK_COLORS[l.res];
        return (
          <g key={l.key}>
            <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#232b37" strokeWidth={0.24} />
            <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#06080b" strokeWidth={0.17} />
            <line
              x1={l.x1}
              y1={l.y1}
              x2={l.x2}
              y2={l.y2}
              stroke={c}
              strokeOpacity={l.active ? 0.9 : 0.25}
              strokeWidth={0.035}
              strokeDasharray="0.1 0.08"
              style={l.active ? { filter: `drop-shadow(0 0 0.05px ${c})` } : undefined}
            />
          </g>
        );
      })}
    </svg>
  );
}, sameLinks);

/** Бегущие по лентам пакеты ресурсов — отдельный слой, чтобы анимация не перерисовывала ленты. */
const Packets = memo(function Packets({ links }: { links: Link[] }) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-[1] h-full w-full [will-change:transform]"
      viewBox={`0 0 ${GRID} ${GRID}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      {links
        .filter((l) => l.active)
        .map((l) => (
          <motion.circle
            key={l.key}
            r={0.045}
            fill={LINK_COLORS[l.res]}
            initial={{ cx: l.x1, cy: l.y1, opacity: 0 }}
            animate={{ cx: [l.x1, l.x2], cy: [l.y1, l.y2], opacity: [0, 1, 1, 0] }}
            transition={{
              default: { duration: 0.85, repeat: Infinity, ease: 'linear' },
              opacity: { duration: 0.85, repeat: Infinity, ease: 'linear', times: [0, 0.2, 0.8, 1] },
            }}
          />
        ))}
    </svg>
  );
}, sameLinks);

/** Связи сравниваются по содержимому: каждый тик массив новый, но ленты те же. */
function sameLinks(a: { links: Link[] }, b: { links: Link[] }): boolean {
  if (a.links.length !== b.links.length) return false;
  for (let i = 0; i < a.links.length; i++) {
    const x = a.links[i];
    const y = b.links[i];
    if (x.key !== y.key || x.active !== y.active) return false;
  }
  return true;
}

function popupFor(b: Building, bf: BuildingFlow | undefined): { text: string; color: string } | null {
  if (!bf || !b.enabled) return null;
  if (b.type === 'trainer' && bf.pulse) return { text: '+1 модель', color: '#f472b6' };
  if ((b.type === 'publisher' || b.type === 'agi') && bf.out > 0.01) {
    return { text: `+${money(bf.out)}`, color: b.type === 'agi' ? '#f0abfc' : '#34d399' };
  }
  return null;
}

const Tile = memo(function Tile({
  b,
  bf,
  tick,
  selected,
  moving,
  onClick,
}: {
  b: Building;
  bf: BuildingFlow | undefined;
  tick: number;
  selected: boolean;
  moving: boolean;
  onClick: (id: number) => void;
}) {
  const def = BUILDINGS[b.type];
  const Icon = BUILDING_ICONS[b.type];
  const status: Status = bf?.status ?? 'idle';
  const u = bf?.u ?? 0;
  const glow = status === 'working' ? 1 : status === 'partial' ? 0.55 : status === 'paused' ? 0 : 0.18;
  const ledColor = STATUS_COLOR[status];
  const popup = popupFor(b, bf);
  const spinning = (b.type === 'reactor' || b.type === 'agi') && status === 'working';
  const debt = b.type === 'coder' ? b.debt : 0;
  const size = def.size;

  return (
    <motion.div
      initial={{ scale: 0.4, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.3, opacity: 0, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 24 }}
      className="relative z-[2]"
      style={{
        gridColumn: `${b.x + 1} / span ${size}`,
        gridRow: `${b.y + 1} / span ${size}`,
        padding: `${(INSET * 100) / size}%`,
      }}
    >
      <button
        type="button"
        onClick={() => onClick(b.id)}
        className={`tile text-left ${selected ? 'tile-selected' : ''} ${!b.enabled ? 'tile-off' : ''} ${
          status === 'nopower' ? 'tile-dead' : ''
        } ${moving ? 'animate-pulse' : ''}`}
        style={{ ['--c' as string]: def.color, ['--glow' as string]: glow }}
        aria-label={`${def.name} ${serialOf(b)}, Mk.${roman(b.level)}, ${cellName(b.x, b.y)}: ${STATUS_LABEL[status]}, загрузка ${pct(u)}`}
      >
        {b.type === 'agi' && (
          <span
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
              background:
                'conic-gradient(from 0deg, #22d3ee33, #a855f733, #f472b633, #34d39933, #22d3ee33)',
            }}
          />
        )}
        {debt >= 15 && (
          <span
            className="pointer-events-none absolute inset-0"
            style={{ boxShadow: `inset 0 0 ${6 + debt * 0.22}px rgba(251,146,60,${0.15 + debt / 200})` }}
          />
        )}
        <span className="absolute left-[7%] right-[7%] top-[8%] flex items-center justify-between gap-1">
          <span className="tile-serial truncate font-mono text-[8px] leading-none text-steel-300">
            MK·{roman(b.level)}
            {size === 2 && <span className="text-steel-500"> · {serialOf(b)}</span>}
          </span>
          <span
            className={`led shrink-0 ${status === 'working' ? 'led-pulse' : ''}`}
            style={{ ['--led' as string]: ledColor }}
          />
        </span>

        <span className="pointer-events-none absolute inset-0 grid place-items-center">
          <Icon
            className={spinning ? 'spin-slow' : undefined}
            style={{
              width: size === 2 ? '34cqmin' : '40cqmin',
              height: size === 2 ? '34cqmin' : '40cqmin',
              color: def.color,
              filter: `drop-shadow(0 0 ${4 + glow * 6}px ${def.color})`,
              opacity: 0.55 + glow * 0.45,
            }}
            strokeWidth={1.7}
            aria-hidden
          />
        </span>

        {debt >= 20 && (
          <span
            className="absolute left-[7%] top-[26%] flex items-center gap-0.5 rounded-sm bg-black/60 px-0.5 font-mono text-[8px] leading-none"
            style={{ color: debt >= 60 ? '#f43f5e' : '#fb923c' }}
            title={`Техдолг ${Math.round(debt)}%`}
          >
            <Bug size={8} aria-hidden />
            {Math.round(debt)}
          </span>
        )}
        {!b.enabled && (
          <span className="absolute right-[7%] top-[26%] font-mono text-[8px] font-bold tracking-wider text-steel-300">
            СТОП
          </span>
        )}

        <span className="absolute bottom-[7%] left-[7%] right-[7%]">
          <span className="tile-label mb-[3px] justify-center font-mono text-[8px] leading-none">
            <span className="truncate font-semibold tracking-wider" style={{ color: def.color }}>
              {def.short}
            </span>
          </span>
          <span className="block h-[3px] overflow-hidden rounded-full bg-black/70">
            <span
              className="block h-full rounded-full transition-[width] duration-500"
              style={{ width: `${Math.round(u * 100)}%`, background: ledColor }}
            />
          </span>
        </span>

        {popup && (
          <motion.span
            key={tick}
            className="pointer-events-none absolute left-1/2 top-[30%] -translate-x-1/2 whitespace-nowrap font-mono text-[10px] font-bold"
            style={{ color: popup.color, textShadow: `0 0 8px ${popup.color}` }}
            initial={{ y: 4, opacity: 0 }}
            animate={{ y: -18, opacity: [0, 1, 1, 0] }}
            transition={{ duration: 1.05, ease: 'easeOut', times: [0, 0.15, 0.7, 1] }}
          >
            {popup.text}
          </motion.span>
        )}
      </button>
    </motion.div>
  );
});

export function FactoryFloor({
  state,
  selectedId,
  selectedCell,
  moving,
  onCell,
  onBuilding,
  onCancelMove,
}: {
  state: GameState;
  selectedId: number | null;
  selectedCell: { x: number; y: number } | null;
  moving: number | null;
  onCell: (x: number, y: number) => void;
  onBuilding: (id: number) => void;
  onCancelMove: () => void;
}) {
  const f = state.flow;
  const links = useMemo(() => buildLinks(state), [state]);
  const map = useMemo(() => cellMap(state), [state]);
  const opened = openCellCount(state);
  const used = occupiedCells(state);
  const movingB = moving !== null ? state.buildings.find((b) => b.id === moving) : undefined;
  const expanded = opened === GRID * GRID;

  const cells: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) cells.push({ x, y });

  return (
    <Panel
      code="MOD-04"
      title={`Цех · ${expanded ? '8×8' : '6×6'}`}
      icon={Zap}
      color="#22d3ee"
      className="min-h-0 md:flex-1"
      bodyClassName="flex min-h-0 flex-1 flex-col gap-2 p-2 sm:p-3"
      right={
        <div className="flex items-center gap-3 font-mono text-[10px] text-steel-300">
          <span className="hidden items-center gap-2 sm:flex" aria-label="Цвета конвейеров">
            {(Object.keys(LINK_COLORS) as LinkRes[]).map((r) => (
              <span key={r} className="flex items-center gap-1">
                <span className="inline-block h-[3px] w-3 rounded" style={{ background: LINK_COLORS[r], boxShadow: `0 0 6px ${LINK_COLORS[r]}` }} />
                {r === 'data' ? 'данные' : r === 'code' ? 'код' : r === 'models' ? 'модели' : 'compute'}
              </span>
            ))}
          </span>
          <span className="num text-steel-200">
            {used}/{opened}
          </span>
        </div>
      }
    >
      <AnimatePresence>
        {movingB && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="flex items-center gap-2 rounded border border-data/50 bg-data/10 px-3 py-1.5 font-mono text-[11px] text-data"
          >
            <Move size={14} aria-hidden />
            <span className="min-w-0 flex-1">
              Перенос: {BUILDINGS[movingB.type].name} {serialOf(movingB)}. Выберите свободную ячейку.
            </span>
            <button type="button" className="btn !min-h-0 !py-0.5 text-[10px]" onClick={onCancelMove}>
              Отмена · Esc
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="floor-host">
        <div className="floor-fit grid grid-cols-[1.1rem_minmax(0,1fr)] grid-rows-[1.1rem_minmax(0,1fr)]">
          <span />
          <div className="grid grid-cols-8 font-mono text-[9px] text-steel-500">
            {COLS.split('').map((c) => (
              <span key={c} className="grid place-items-center">
                {c}
              </span>
            ))}
          </div>
          <div className="grid grid-rows-8 font-mono text-[9px] text-steel-500">
            {Array.from({ length: GRID }, (_, i) => (
              <span key={i} className="grid place-items-center">
                {i + 1}
              </span>
            ))}
          </div>

          <div className="floor relative grid aspect-square min-h-0 grid-cols-8 grid-rows-8 overflow-hidden rounded-md">
            {cells.map(({ x, y }) => {
              const occupied = map[y * GRID + x] >= 0;
              const open = isCellOpen(state, x, y);
              if (occupied) return null;
              const target = movingB !== undefined && open;
              const sel = selectedCell && selectedCell.x === x && selectedCell.y === y;
              return (
                <div key={`${x},${y}`} style={{ gridColumn: x + 1, gridRow: y + 1, padding: `${INSET * 100 * 0.6}%` }}>
                  {open ? (
                    <button
                      type="button"
                      onClick={() => onCell(x, y)}
                      className={`cell-plate group grid h-full w-full place-items-center ${
                        target ? '!border-data/60 !bg-data/5' : ''
                      } ${sel ? '!border-data !bg-data/10' : ''}`}
                      aria-label={
                        movingB
                          ? `Перенести сюда: ${cellName(x, y)}`
                          : `Ячейка ${cellName(x, y)}: пусто, открыть меню постройки`
                      }
                    >
                      {movingB ? (
                        <Move className="text-data/70" size={14} aria-hidden />
                      ) : (
                        <Plus className="text-data opacity-0 transition-opacity group-hover:opacity-70" size={16} aria-hidden />
                      )}
                    </button>
                  ) : (
                    <div
                      className="hazard-soft grid h-full w-full place-items-center rounded-[5px] border border-energy/15"
                      title="Откроется после исследования «Расширение цеха»"
                    >
                      <Lock size={12} className="text-energy/35" aria-hidden />
                    </div>
                  )}
                </div>
              );
            })}

            <Belts links={links} />
            <Packets links={links} />

            <AnimatePresence>
              {state.buildings.map((b) => (
                <Tile
                  key={`${b.id}@${b.x},${b.y}`}
                  b={b}
                  bf={f.b[b.id]}
                  tick={state.tick}
                  selected={selectedId === b.id || moving === b.id}
                  moving={moving === b.id}
                  onClick={onBuilding}
                />
              ))}
            </AnimatePresence>

            <AnimatePresence>
              {f.blackout && (
                <motion.div
                  key="blackout"
                  className="pointer-events-none absolute inset-0 z-[3] grid place-items-center"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <div className="hazard-red blackout-flicker absolute inset-0" />
                  <div className="relative rounded border-2 border-alert bg-void/90 px-4 py-2 text-center shadow-[0_0_40px_rgba(244,63,94,0.45)]">
                    <div className="font-display text-lg tracking-[0.2em] text-alert text-glow sm:text-2xl">ОБЕСТОЧЕНО</div>
                    <div className="num mt-1 text-[11px] text-steel-200">
                      нагрузка {num(f.load)} МВт &gt; генерация {num(f.gen)} МВт
                    </div>
                  </div>
                </motion.div>
              )}
              {!f.blackout && f.brownout && (
                <motion.div
                  key="brownout"
                  className="pointer-events-none absolute inset-x-0 top-0 z-[3] flex justify-center p-2"
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <div className="rounded border border-energy/70 bg-void/85 px-3 py-1 font-mono text-[11px] text-energy">
                    Дефицит мощности · цех работает на {pct(f.power)}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </Panel>
  );
}
