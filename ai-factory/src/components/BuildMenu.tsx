import { motion } from 'framer-motion';
import { Hammer, Link2, Lock } from 'lucide-react';
import { BAL, BUILDINGS, BUILD_ORDER, FEEDS, RESEARCH } from '../game/config';
import { buildBlocker } from '../game/engine';
import { money, num } from '../game/format';
import { buildCost, cellName, countType, getMods, modelPrice, ratesFor } from '../game/selectors';
import type { Building, BuildingType, GameState } from '../game/types';
import { BUILDING_ICONS } from '../ui/icons';
import { Modal } from '../ui/primitives';

/** Короткая «формула» здания уровня Mk.I с учётом исследований (без бонуса соседства). */
export function recipeOf(state: GameState, type: BuildingType, level = 1): { io: string; energy: string } {
  const mods = getMods(state);
  const b: Building = { id: 0, type, x: 0, y: 0, level, enabled: true, debt: 0, invested: 0, acc: 0 };
  const r = ratesFor(b, mods, 0);
  const price = modelPrice(state, mods);
  let io = '';
  switch (type) {
    case 'reactor':
      io = `+${num(r.gen)} МВт в сеть`;
      break;
    case 'miner':
      io = `→ ${num(r.outData)} ТБ данных/с`;
      break;
    case 'coder':
      io = `${num(r.inData)} ТБ → ${num(r.outCode)} KLOC/с`;
      break;
    case 'gpu':
      io = `+${num(r.computeOut)} PFLOPS`;
      break;
    case 'trainer':
      io = `${num(r.inData)} ТБ + ${num(r.inCode)} KLOC + ${num(r.computeNeed)} PFLOPS → ${num(r.outModels)} мод./с`;
      break;
    case 'publisher':
      io = `продаёт до ${num(r.inModels)} мод./с · ${money(price)} за шт.`;
      break;
    case 'agi':
      io = `до ${num(r.inModels)} мод./с по ${money(price * BAL.agiMult * mods.agiMult)} · ${num(r.computeNeed)} PFLOPS`;
      break;
    case 'storage':
      io = `+${num(r.capBonus * 100)}% вместимости склада`;
      break;
  }
  const energy = type === 'reactor' ? 'генератор' : `−${num(r.energy)} МВт`;
  return { io, energy };
}

export function feedHint(type: BuildingType): string | null {
  const feeds = FEEDS[type];
  if (!feeds) return null;
  return feeds.map((t) => BUILDINGS[t].name).join(', ');
}

export function BuildMenu({
  state,
  cell,
  onBuild,
  onClose,
}: {
  state: GameState;
  cell: { x: number; y: number } | null;
  onBuild: (type: BuildingType) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={cell !== null}
      onClose={onClose}
      code={cell ? `ЯЧЕЙКА ${cellName(cell.x, cell.y)}` : 'ЯЧЕЙКА'}
      title="Строительство узла"
      icon={Hammer}
      width="max-w-3xl"
    >
      {cell && (
        <div className="grid gap-2 sm:grid-cols-2">
          {BUILD_ORDER.map((type, i) => {
            const def = BUILDINGS[type];
            const Icon = BUILDING_ICONS[type];
            const cost = buildCost(state, type);
            const blocker = buildBlocker(state, type, cell.x, cell.y);
            const locked = !!def.requires && !state.research.done.includes(def.requires);
            const affordable = state.credits >= cost;
            const { io, energy } = recipeOf(state, type);
            const hint = feedHint(type);
            const count = countType(state, type);
            return (
              <motion.button
                key={type}
                type="button"
                disabled={!!blocker}
                onClick={() => onBuild(type)}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.025 }}
                className="group relative flex gap-3 rounded-md border border-steel-700 bg-steel-900/80 p-3 text-left transition-[border-color,box-shadow] enabled:hover:border-[var(--c)] enabled:hover:shadow-[0_0_22px_color-mix(in_srgb,var(--c)_25%,transparent)] disabled:cursor-not-allowed"
                style={{ ['--c' as string]: def.color }}
              >
                <span
                  className="grid h-12 w-12 shrink-0 place-items-center rounded-md border"
                  style={{
                    borderColor: `${def.color}66`,
                    background: `radial-gradient(circle, ${def.color}22, transparent 70%)`,
                    opacity: locked ? 0.45 : 1,
                  }}
                >
                  {locked ? <Lock size={20} className="text-steel-400" /> : <Icon size={24} color={def.color} strokeWidth={1.7} />}
                  {def.size === 2 && (
                    <span className="sr-only">Занимает блок 2 на 2</span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-display text-[13px] tracking-wide" style={{ color: locked ? '#8f9bad' : def.color }}>
                      {def.name}
                    </span>
                    <span className={`num shrink-0 text-[12px] font-semibold ${affordable ? 'text-cash' : 'text-alert'}`}>
                      {money(cost)}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-steel-300">{def.desc}</span>
                  <span className="num mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-steel-200">
                    <span>{io}</span>
                    <span className={type === 'reactor' ? 'text-energy' : 'text-steel-400'}>{energy}</span>
                    {def.size === 2 && <span className="text-agi">блок 2×2</span>}
                  </span>
                  {hint && (
                    <span className="mt-1 flex items-center gap-1 text-[10.5px] text-steel-400">
                      <Link2 size={11} aria-hidden /> +{Math.round(BAL.adjBonus * 100)}% за соседа: {hint}
                    </span>
                  )}
                  <span className="mt-1 flex items-center justify-between font-mono text-[10px]">
                    <span className="text-steel-500">на сетке: {count}</span>
                    {blocker && (
                      <span className="text-right text-alert/90">
                        {locked ? `Нужно: ${RESEARCH[def.requires!].name}` : blocker}
                      </span>
                    )}
                  </span>
                </span>
              </motion.button>
            );
          })}
        </div>
      )}
      <p className="mt-3 text-[12px] leading-snug text-steel-400">
        Цепочка: реактор даёт ток → генераторы добывают данные → блоки вайбкодинга пишут код → кластеры LLM на мощностях
        GPU обучают модели → терминалы SaaS и AGI продают их. Каждое следующее здание того же типа дороже предыдущего.
      </p>
    </Modal>
  );
}
