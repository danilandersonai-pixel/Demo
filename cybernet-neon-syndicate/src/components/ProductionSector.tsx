import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUpCircle, Factory, Lock, LockOpen, Plus, Power, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  BUILDINGS,
  BUILDING_ORDER,
  COLUMN_LABELS,
  DEMOLISH_REFUND,
  GRID_COLS,
  GRID_ROWS,
  MAX_LEVEL,
  OVERHEAD_PER_ROW,
  RESEARCH,
  cellLabel,
  neighborsOf,
  outputMult,
  useLevelMult,
} from '../game/config.ts';
import { buildCost, cellOutput, countBuildings, hasResearch, optimizerAura, upgradeCost, type CellOutput } from '../game/economy.ts';
import { fmt, fmtPct } from '../game/format.ts';
import {
  checkBuild,
  checkDemolish,
  checkToggle,
  checkUnlockRow,
  checkUpgrade,
  isCellUnlocked,
  nextRowCost,
  resolveBuildTarget,
} from '../game/rules.ts';
import type { BuildingId, Cell, Cost } from '../game/types.ts';
import { useGameContext } from './GameContext.tsx';
import { ACCENT } from './ui/accent.ts';
import { cn } from './ui/cn.ts';
import { BUILDING_ICONS } from './ui/icons.ts';
import { NeonButton } from './ui/NeonButton.tsx';
import { Panel } from './ui/Panel.tsx';

/** Модуль 2 — сектор производства и строительства. */
export function ProductionSector({ className }: { className?: string }) {
  const { state } = useGameContext();
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const target = resolveBuildTarget(state, selected);
  const built = countBuildings(state);
  const open = state.rowsUnlocked * GRID_COLS;

  // Если выбранное здание разрушено (рейд) — выделение остаётся на пустой ячейке, это нормально.
  // Если ряд стал недоступен (новая игра) — сбрасываем выбор.
  useEffect(() => {
    if (selected !== null && !isCellUnlocked(state, selected)) setSelected(null);
  }, [selected, state]);

  return (
    <Panel
      id="production"
      code="MOD-02 // FABRICATION_GRID"
      title="Сектор производства"
      icon={Factory}
      accent="energy"
      className={className}
      delay={0.05}
      actions={
        <span className="font-mono text-[10px] tracking-[0.2em] text-dim">
          ЗАНЯТО <span className="text-ink">{built}</span>/{open} · ВСЕГО {GRID_COLS * GRID_ROWS}
        </span>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <BuildCatalog target={target} onBuilt={setSelected} />
        <div className="flex min-w-0 flex-col gap-3">
          <SectorGrid selected={selected} hovered={hovered} target={target} onSelect={setSelected} onHover={setHovered} />
          <CellInspector index={selected} />
          <RowUnlock />
        </div>
      </div>
    </Panel>
  );
}

function CostTag({ cost, className }: { cost: Cost; className?: string }) {
  const { state } = useGameContext();
  return (
    <span className={cn('tabular font-mono text-xs', className)}>
      <span className={state.credits >= cost.credits ? 'text-credit' : 'text-danger'}>{fmt(cost.credits)}₵</span>
      {cost.data > 0 ? (
        <>
          <span className="text-dim"> + </span>
          <span className={state.data >= cost.data ? 'text-data' : 'text-danger'}>{fmt(cost.data)} DB</span>
        </>
      ) : null}
    </span>
  );
}

function StatChips({ output, type }: { output: CellOutput | null; type: BuildingId }) {
  const def = BUILDINGS[type];
  const { econ } = useGameContext();
  const chips: Array<{ text: string; cls: string }> = [];
  if (output) {
    if (output.energyProd > 0) chips.push({ text: `+${fmt(output.energyProd, 1)}⚡`, cls: 'text-energy' });
    if (output.credits > 0) chips.push({ text: `+${fmt(output.credits, 1)}₵`, cls: 'text-credit' });
    if (output.data > 0) chips.push({ text: `+${fmt(output.data, 1)} DB`, cls: 'text-data' });
    if (output.energyUse > 0) chips.push({ text: `−${fmt(output.energyUse, 1)}⚡`, cls: 'text-muted' });
    chips.push({ text: `−${fmt(output.upkeep, 2)}₵/д`, cls: 'text-dim' });
  }
  if (def.aura > 0) chips.push({ text: `${fmtPct(optimizerAura(1, econ.mults))} соседям`, cls: 'text-research' });
  if (def.dataCap > 0) chips.push({ text: `+${def.dataCap} хран.`, cls: 'text-dim' });
  return (
    <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 font-mono text-[11px]">
      {chips.map((chip) => (
        <span key={chip.text} className={cn('tabular', chip.cls)}>
          {chip.text}
        </span>
      ))}
    </div>
  );
}

function BuildCatalog({ target, onBuilt }: { target: number; onBuilt: (index: number) => void }) {
  const { state, econ, dispatch } = useGameContext();
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between font-mono text-[10px] tracking-[0.2em] text-dim">
        <span>КАТАЛОГ ОБЪЕКТОВ</span>
        <span>
          ЦЕЛЬ: <span className="text-data">{target >= 0 ? cellLabel(target) : '—'}</span>
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
        {BUILDING_ORDER.map((type) => {
          const def = BUILDINGS[type];
          const Icon = BUILDING_ICONS[type];
          const a = ACCENT[def.accent];
          const locked = def.requires !== null && !hasResearch(state, def.requires);
          const check = checkBuild(state, type, target);
          const cost = buildCost(state, type);
          const owned = countBuildings(state, type);
          const preview =
            target >= 0
              ? cellOutput({ uid: 1, type, level: 1, enabled: true, invested: 0, builtDay: 0 }, target, econ.aura[target], econ.mults, econ.inflation)
              : cellOutput({ uid: 1, type, level: 1, enabled: true, invested: 0, builtDay: 0 }, 0, 0, econ.mults, econ.inflation);
          return (
            <div
              key={type}
              className={cn(
                'relative flex min-w-0 gap-3 border p-2.5 transition-colors',
                locked ? 'border-line bg-white/[0.01] opacity-55' : check.ok ? cn(a.border, 'bg-gradient-to-br to-transparent', a.from) : 'border-line bg-white/[0.015]',
              )}
            >
              <div className={cn('grid size-10 shrink-0 place-items-center border', locked ? 'border-line' : a.border, a.soft)}>
                {locked ? <Lock className="size-4 text-dim" /> : <Icon className={cn('size-5', a.text)} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold leading-tight text-ink">{def.name}</div>
                    <div className="font-mono text-[9px] tracking-[0.2em] text-dim">
                      {def.tag} · ×{owned}
                    </div>
                  </div>
                  {!locked ? <CostTag cost={cost} className="shrink-0 text-right" /> : null}
                </div>
                {locked ? (
                  <p className="mt-1 text-[11px] leading-snug text-muted">Откроется исследованием «{RESEARCH[def.requires!].name}»</p>
                ) : (
                  <>
                    <div className="mt-1">
                      <StatChips output={preview} type={type} />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className={cn('min-w-0 font-mono text-[10px] leading-tight', check.ok ? 'text-dim' : 'text-danger/90')}>
                        {check.ok ? (econ.aura[target] > 0 && def.aura === 0 ? `ИИ-бонус ${fmtPct(econ.aura[target])}` : 'готово к стройке') : check.reason}
                      </span>
                      <NeonButton
                        size="xs"
                        variant="solid"
                        accent={def.accent}
                        disabled={!check.ok}
                        onClick={() => {
                          dispatch({ type: 'BUILD', building: type, cell: target });
                          onBuilt(target);
                        }}
                        aria-label={`Построить: ${def.name}`}
                      >
                        <Plus className="size-3" /> Построить
                      </NeonButton>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface SectorGridProps {
  selected: number | null;
  hovered: number | null;
  target: number;
  onSelect: (index: number | null) => void;
  onHover: (index: number | null) => void;
}

function SectorGrid({ selected, hovered, target, onSelect, onHover }: SectorGridProps) {
  const { state, econ } = useGameContext();
  // Подсветка зоны действия оптимизатора (наведён или выбран).
  const focus = hovered ?? selected;
  const auraZone = new Set<number>(focus !== null && state.grid[focus]?.type === 'optimizer' ? neighborsOf(focus) : []);

  return (
    <div className="min-w-0">
      <div className="grid grid-cols-[14px_repeat(6,minmax(0,1fr))] gap-1.5">
        <span />
        {COLUMN_LABELS.split('').map((c) => (
          <span key={c} className="text-center font-mono text-[9px] text-dim">
            {c}
          </span>
        ))}
        {Array.from({ length: GRID_ROWS }, (_, row) => (
          <RowCells
            key={row}
            row={row}
            selected={selected}
            target={target}
            auraZone={auraZone}
            onSelect={onSelect}
            onHover={onHover}
            unlocked={row < state.rowsUnlocked}
            aura={econ.aura}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-dim">
        <span className="flex items-center gap-1.5">
          <span className="size-2 border border-dashed border-data/70" /> цель стройки
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 border border-dashed border-research/80" /> зона ИИ-Оптимизатора
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-research">+15%</span> бонус соседей
        </span>
      </div>
    </div>
  );
}

interface RowCellsProps {
  row: number;
  selected: number | null;
  target: number;
  auraZone: Set<number>;
  unlocked: boolean;
  aura: number[];
  onSelect: (index: number | null) => void;
  onHover: (index: number | null) => void;
}

function RowCells({ row, selected, target, auraZone, unlocked, aura, onSelect, onHover }: RowCellsProps) {
  const { state, econ } = useGameContext();
  return (
    <>
      <span className="self-center text-center font-mono text-[9px] text-dim">{row + 1}</span>
      {Array.from({ length: GRID_COLS }, (_, col) => {
        const index = row * GRID_COLS + col;
        const cell = state.grid[index];
        if (!unlocked) {
          return (
            <div key={index} className="hatch grid aspect-square place-items-center border border-line/70" aria-label={`Ячейка ${cellLabel(index)} заблокирована`}>
              <Lock className="size-3 text-dim/70" aria-hidden />
            </div>
          );
        }
        return (
          <GridCell
            key={`${index}-${cell.uid}`}
            index={index}
            cell={cell}
            selected={selected === index}
            isTarget={target === index && !cell.type}
            inAura={auraZone.has(index)}
            aura={aura[index]}
            output={econ.cells[index]}
            blackout={state.blackout}
            onSelect={onSelect}
            onHover={onHover}
          />
        );
      })}
    </>
  );
}

interface GridCellProps {
  index: number;
  cell: Cell;
  selected: boolean;
  isTarget: boolean;
  inAura: boolean;
  aura: number;
  output: CellOutput | null;
  blackout: boolean;
  onSelect: (index: number | null) => void;
  onHover: (index: number | null) => void;
}

function GridCell({ index, cell, selected, isTarget, inAura, aura, output, blackout, onSelect, onHover }: GridCellProps) {
  const label = cellLabel(index);
  const common = {
    onClick: () => onSelect(selected ? null : index),
    onMouseEnter: () => onHover(index),
    onMouseLeave: () => onHover(null),
    onFocus: () => onHover(index),
    onBlur: () => onHover(null),
  };

  if (!cell.type) {
    return (
      <button
        type="button"
        {...common}
        aria-label={`Пустая ячейка ${label}${isTarget ? ', цель стройки' : ''}${aura > 0 ? `, бонус ${fmtPct(aura)}` : ''}`}
        aria-pressed={selected}
        className={cn(
          'group relative grid aspect-square place-items-center border border-dashed transition-colors',
          isTarget ? 'border-data/80 bg-data/[0.07]' : 'border-line hover:border-muted/50 hover:bg-white/[0.03]',
          selected && 'ring-1 ring-data/70',
          inAura && 'outline outline-1 -outline-offset-4 outline-dashed outline-research/70',
        )}
      >
        <span className="absolute left-1 top-0.5 font-mono text-[8px] text-dim">{label}</span>
        {aura > 0 ? <span className="absolute right-1 top-0.5 font-mono text-[8px] text-research">{fmtPct(aura)}</span> : null}
        <Plus className={cn('size-3.5 transition-opacity', isTarget ? 'text-data opacity-90' : 'text-dim opacity-0 group-hover:opacity-70')} aria-hidden />
        {isTarget ? <span className="absolute bottom-0.5 font-mono text-[7px] tracking-widest text-data">ЦЕЛЬ</span> : null}
      </button>
    );
  }

  const def = BUILDINGS[cell.type];
  const Icon = BUILDING_ICONS[cell.type];
  const a = ACCENT[def.accent];
  const consumer = def.energyUse > 0;
  const unpowered = blackout && consumer && cell.enabled;
  const producer = def.creditProd > 0 || def.dataProd > 0 || def.energyProd > 0;
  const summary = output
    ? [
        output.energyProd > 0 ? `+${fmt(output.energyProd, 1)}⚡` : '',
        output.credits > 0 ? `+${fmt(output.credits, 1)}₵` : '',
        output.data > 0 ? `+${fmt(output.data, 1)} DB` : '',
        output.energyUse > 0 ? `−${fmt(output.energyUse, 1)}⚡` : '',
      ]
        .filter(Boolean)
        .join(' ')
    : '';

  return (
    <motion.button
      type="button"
      {...common}
      aria-label={`${def.name}, ${label}, уровень ${cell.level}${cell.enabled ? '' : ', режим ожидания'}${unpowered ? ', обесточено' : ''}`}
      aria-pressed={selected}
      title={`${def.name} · ур. ${cell.level} · ${summary}`}
      initial={{ scale: 0.35, opacity: 0, rotateX: 65 }}
      animate={{ scale: 1, opacity: 1, rotateX: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 19 }}
      className={cn(
        'relative grid aspect-square place-items-center overflow-hidden border bg-gradient-to-br to-transparent transition-shadow',
        a.border,
        a.from,
        selected && cn('ring-2', a.ring),
        inAura && 'outline outline-1 -outline-offset-4 outline-dashed outline-research/80',
        !cell.enabled && 'opacity-40 grayscale',
        unpowered && 'flicker border-danger/60',
      )}
      style={{ transformPerspective: 600 }}
    >
      {/* Анимация развёртывания: сканирующая полоса и надпись DEPLOY. */}
      <motion.span
        className="pointer-events-none absolute inset-x-0 h-0.5"
        style={{ background: a.hex, boxShadow: `0 0 10px ${a.hex}` }}
        initial={{ top: '0%', opacity: 1 }}
        animate={{ top: '100%', opacity: 0 }}
        transition={{ duration: 0.9, ease: 'easeInOut' }}
      />
      <motion.span
        className={cn('pointer-events-none absolute inset-0 grid place-items-center bg-void/70 font-mono text-[8px] font-bold tracking-[0.2em]', a.text)}
        initial={{ opacity: 1 }}
        animate={{ opacity: 0 }}
        transition={{ delay: 0.55, duration: 0.45 }}
      >
        DEPLOY
      </motion.span>
      {/* Вспышка при улучшении. */}
      <motion.span
        key={cell.level}
        className="pointer-events-none absolute inset-0 border-2"
        style={{ borderColor: a.hex }}
        initial={{ opacity: 0.9, scale: 0.7 }}
        animate={{ opacity: 0, scale: 1.2 }}
        transition={{ duration: 0.7, ease: 'easeOut' }}
      />
      <span className="absolute left-1 top-0.5 font-mono text-[8px] text-dim">{label}</span>
      {producer && aura > 0 ? <span className="absolute right-1 top-0.5 font-mono text-[8px] text-research">{fmtPct(aura)}</span> : null}
      {def.aura > 0 ? (
        <span className="pointer-events-none absolute inset-1 rounded-full bg-research/15 blur-md" aria-hidden />
      ) : null}
      <Icon className={cn('relative size-5 sm:size-6', unpowered ? 'text-danger' : a.text)} style={{ filter: `drop-shadow(0 0 6px ${unpowered ? '#ff4d6d' : a.hex})` }} aria-hidden />
      {!cell.enabled ? <span className="absolute bottom-3 font-mono text-[7px] tracking-widest text-muted">STBY</span> : null}
      <span className="absolute inset-x-1.5 bottom-1 flex gap-0.5" aria-hidden>
        {Array.from({ length: MAX_LEVEL }, (_, i) => (
          <span key={i} className={cn('h-[3px] flex-1', i < cell.level ? a.bg : 'bg-white/10')} />
        ))}
      </span>
    </motion.button>
  );
}

function Stat({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[9px] tracking-[0.18em] text-dim">{label}</div>
      <div className={cn('tabular truncate font-mono text-[13px]', cls ?? 'text-ink')}>{value}</div>
    </div>
  );
}

function CellInspector({ index }: { index: number | null }) {
  const { state, econ, dispatch } = useGameContext();
  const [confirm, setConfirm] = useState<number | null>(null);

  useEffect(() => {
    if (confirm === null) return undefined;
    const id = window.setTimeout(() => setConfirm(null), 3500);
    return () => window.clearTimeout(id);
  }, [confirm]);

  const box = 'border border-line bg-void/40 p-3';

  if (index === null) {
    return (
      <div className={box}>
        <p className="text-[12px] leading-relaxed text-muted">
          Нажмите на ячейку сетки. <span className="text-data">Пустую</span> — чтобы выбрать место стройки,{' '}
          <span className="text-ink">занятую</span> — чтобы улучшить, отключить или демонтировать объект. ИИ-Оптимизатор усиливает все 8 соседних ячеек.
        </p>
      </div>
    );
  }

  const cell = state.grid[index];
  const label = cellLabel(index);

  if (!cell.type) {
    const aura = econ.aura[index];
    return (
      <div className={box}>
        <div className="font-mono text-[10px] tracking-[0.2em] text-dim">ЯЧЕЙКА {label} · СВОБОДНА</div>
        <p className="mt-1 text-[12px] leading-relaxed text-muted">
          Цель строительства выбрана — нажмите «Построить» в каталоге.{' '}
          {aura > 0 ? (
            <span className="text-research">Соседние ИИ-Оптимизаторы дадут здесь {fmtPct(aura)} к выработке.</span>
          ) : (
            'Рядом нет ИИ-Оптимизаторов.'
          )}
        </p>
      </div>
    );
  }

  const def = BUILDINGS[cell.type];
  const Icon = BUILDING_ICONS[cell.type];
  const a = ACCENT[def.accent];
  const output = econ.cells[index];
  const upCheck = checkUpgrade(state, index);
  const toggleCheck = checkToggle(state, index);
  const demolishCheck = checkDemolish(state, index);
  const upCost = upgradeCost(cell);
  const refund = Math.round(cell.invested * DEMOLISH_REFUND);
  const maxed = cell.level >= MAX_LEVEL;
  const unpowered = state.blackout && def.energyUse > 0 && cell.enabled;
  const status = !cell.enabled ? { t: 'ОЖИДАНИЕ', c: 'text-muted border-line' } : unpowered ? { t: 'ОБЕСТОЧЕН', c: 'text-danger border-danger/50' } : { t: 'РАБОТАЕТ', c: 'text-credit border-credit/40' };
  const nextGain = maxed ? 0 : outputMult(cell.level + 1) / outputMult(cell.level) - 1;
  const nextUse = maxed || def.energyUse === 0 ? 0 : def.energyUse * (useLevelMult(cell.level + 1) - useLevelMult(cell.level)) * econ.mults.use;
  const boosted = def.aura > 0 ? neighborsOf(index).filter((n) => {
    const t = state.grid[n].type;
    return t && t !== 'optimizer';
  }).length : 0;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={`${index}-${cell.uid}`}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className={cn(box, a.border)}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className={cn('grid size-9 place-items-center border', a.border, a.soft)}>
              <Icon className={cn('size-4.5', a.text)} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[14px] font-semibold text-ink">{def.name}</div>
              <div className="font-mono text-[10px] tracking-[0.18em] text-dim">
                {label} · УР. {cell.level}/{MAX_LEVEL} · С {cell.builtDay}-ГО ДНЯ
              </div>
            </div>
          </div>
          <span className={cn('border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-widest', status.c)}>{status.t}</span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {def.energyProd > 0 ? <Stat label="ВЫРАБОТКА" value={`+${fmt(output?.energyProd ?? 0, 1)}⚡`} cls="text-energy" /> : null}
          {def.creditProd > 0 ? <Stat label="ДОБЫЧА" value={`+${fmt(output?.credits ?? 0, 1)}₵`} cls="text-credit" /> : null}
          {def.dataProd > 0 ? <Stat label="ДАННЫЕ" value={`+${fmt(output?.data ?? 0, 1)}`} cls="text-data" /> : null}
          {def.energyUse > 0 ? <Stat label="ПОТРЕБЛЕНИЕ" value={`−${fmt(output?.energyUse ?? 0, 1)}⚡`} cls="text-muted" /> : null}
          {def.aura > 0 ? <Stat label="БОНУС СОСЕДЯМ" value={`${fmtPct(optimizerAura(cell.level, econ.mults))} ×${boosted}`} cls="text-research" /> : null}
          <Stat label="СОДЕРЖАНИЕ" value={`−${fmt(output?.upkeep ?? 0, 2)}₵`} cls="text-danger" />
          {output && output.adjBonus > 0 && def.aura === 0 ? <Stat label="ИИ-БОНУС" value={fmtPct(output.adjBonus)} cls="text-research" /> : null}
        </div>

        {!maxed ? (
          <p className="mt-2.5 font-mono text-[10px] text-dim">
            Ур. {cell.level + 1}: выработка <span className="text-credit">{fmtPct(nextGain)}</span>
            {nextUse > 0 ? (
              <>
                , потребление <span className="text-energy">+{fmt(nextUse, 1)}⚡</span>
              </>
            ) : null}
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <NeonButton
            size="sm"
            variant="solid"
            accent={def.accent}
            disabled={!upCheck.ok}
            onClick={() => dispatch({ type: 'UPGRADE', cell: index })}
          >
            <ArrowUpCircle className="size-3.5" />
            {maxed ? 'Макс. уровень' : 'Улучшить'}
            {!maxed ? (
              <span className="normal-case tracking-normal opacity-80">
                {fmt(upCost.credits)}₵{upCost.data > 0 ? ` +${fmt(upCost.data)}DB` : ''}
              </span>
            ) : null}
          </NeonButton>
          <NeonButton size="sm" accent="data" disabled={!toggleCheck.ok} onClick={() => dispatch({ type: 'TOGGLE', cell: index })}>
            <Power className="size-3.5" />
            {cell.enabled ? 'Ожидание' : 'Включить'}
          </NeonButton>
          <NeonButton
            size="sm"
            accent="danger"
            variant={confirm === index ? 'solid' : 'outline'}
            disabled={!demolishCheck.ok}
            onClick={() => {
              if (confirm === index) {
                dispatch({ type: 'DEMOLISH', cell: index });
                setConfirm(null);
              } else {
                setConfirm(index);
              }
            }}
          >
            <Trash2 className="size-3.5" />
            {confirm === index ? `Точно? +${fmt(refund)}₵` : 'Демонтаж'}
          </NeonButton>
        </div>
        {[upCheck, toggleCheck, demolishCheck].some((c) => !c.ok) ? (
          <div className="mt-2 space-y-0.5 font-mono text-[10px]">
            {!upCheck.ok && !maxed ? <p className="text-danger/90">Улучшение: {upCheck.reason}</p> : null}
            {!toggleCheck.ok ? <p className="text-danger/90">Переключение: {toggleCheck.reason}</p> : null}
            {!demolishCheck.ok ? <p className="text-danger/90">Демонтаж: {demolishCheck.reason}</p> : null}
          </div>
        ) : null}
        <p className="mt-2 text-[11px] leading-snug text-dim">{def.description}</p>
      </motion.div>
    </AnimatePresence>
  );
}

function RowUnlock() {
  const { state, dispatch } = useGameContext();
  const cost = nextRowCost(state);
  const check = checkUnlockRow(state);
  if (!cost) {
    return (
      <div className="flex items-center gap-2 border border-line bg-void/40 px-3 py-2 font-mono text-[11px] text-dim">
        <LockOpen className="size-3.5 text-credit" /> Сектор открыт полностью — 36 ячеек
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border border-line bg-void/40 px-3 py-2">
      <div className="min-w-0 font-mono text-[11px]">
        <div className="text-dim">РАСШИРЕНИЕ СЕКТОРА · РЯД {state.rowsUnlocked + 1}</div>
        <div>
          <CostTag cost={cost} /> <span className="text-dim">· накладные +{OVERHEAD_PER_ROW}₵/д × инфляция</span>
        </div>
      </div>
      <NeonButton size="xs" accent="energy" disabled={!check.ok} onClick={() => dispatch({ type: 'UNLOCK_ROW' })} title={check.reason ?? undefined}>
        <LockOpen className="size-3" /> Открыть ряд
      </NeonButton>
    </div>
  );
}
