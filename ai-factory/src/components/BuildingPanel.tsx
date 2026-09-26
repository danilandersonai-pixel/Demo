import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUpCircle, Bug, Move, Power, Trash2, WandSparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BAL, BUILDINGS } from '../game/config';
import { money, num, pct, roman } from '../game/format';
import {
  cellMap,
  cellName,
  energyUse,
  getMods,
  levelOut,
  modelPrice,
  ratesFor,
  ratesOf,
  refactorCost,
  refundOf,
  serialOf,
  upgradeCost,
  type Rates,
} from '../game/selectors';
import type { Building, GameState, Limit } from '../game/types';
import { BUILDING_ICONS } from '../ui/icons';
import { Badge, Meter, Modal } from '../ui/primitives';
import { STATUS_COLOR, STATUS_LABEL } from './FactoryFloor';
import { feedHint } from './BuildMenu';

const LIMIT_TEXT: Record<Limit, string> = {
  none: 'Работает на полную мощность.',
  paused: 'Остановлен вручную — не потребляет энергию.',
  power: 'Не хватает энергии: постройте или улучшите Квантовый реактор.',
  compute: 'Не хватает вычислений: нужен ещё GPU-кластер.',
  data: 'Не хватает сырых данных: добавьте Генераторы данных.',
  code: 'Не хватает чистого кода: добавьте Блоки вайбкодинга (или его забирает НИОКР).',
  models: 'Нет моделей на складе: нужны Кластеры обучения LLM.',
  space: 'Склад продукции заполнен: нужен сбыт, автопродажа или Хранилище.',
};

function mainOutput(b: Building, r: Rates, state: GameState): { value: number; unit: string; label: string } {
  const mods = getMods(state);
  const price = modelPrice(state, mods);
  switch (b.type) {
    case 'reactor':
      return { value: r.gen, unit: 'МВт', label: 'Генерация' };
    case 'miner':
      return { value: r.outData, unit: 'ТБ/с', label: 'Добыча' };
    case 'coder':
      return { value: r.outCode, unit: 'KLOC/с', label: 'Выпуск кода' };
    case 'gpu':
      return { value: r.computeOut, unit: 'PFLOPS', label: 'Вычисления' };
    case 'trainer':
      return { value: r.outModels, unit: 'мод./с', label: 'Обучение' };
    case 'publisher':
      return { value: r.inModels * price, unit: '$/с', label: 'Выручка' };
    case 'agi':
      return { value: r.inModels * price * BAL.agiMult * mods.agiMult, unit: '$/с', label: 'Выручка' };
    case 'storage':
      return { value: r.capBonus * 100, unit: '% склада', label: 'Вместимость' };
  }
}

function inputsOf(b: Building, r: Rates): string | null {
  switch (b.type) {
    case 'coder':
      return `${num(r.inData)} ТБ/с`;
    case 'trainer':
      return `${num(r.inData)} ТБ + ${num(r.inCode)} KLOC/с, ${num(r.computeNeed)} PFLOPS`;
    case 'publisher':
      return `${num(r.inModels)} мод./с`;
    case 'agi':
      return `${num(r.inModels)} мод./с, ${num(r.computeNeed)} PFLOPS`;
    default:
      return null;
  }
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded border border-steel-750 bg-steel-950/70 px-2.5 py-2">
      <div className="font-mono text-[9.5px] uppercase tracking-wider text-steel-400">{label}</div>
      <div className="num mt-0.5 text-[13px] font-semibold" style={{ color: color ?? '#dde3ec' }}>
        {value}
      </div>
      {sub && <div className="num text-[10px] text-steel-400">{sub}</div>}
    </div>
  );
}

export function BuildingPanel({
  state,
  id,
  onClose,
  onUpgrade,
  onToggle,
  onMove,
  onDemolish,
  onRefactor,
}: {
  state: GameState;
  id: number | null;
  onClose: () => void;
  onUpgrade: (id: number) => void;
  onToggle: (id: number) => void;
  onMove: (id: number) => void;
  onDemolish: (id: number) => void;
  onRefactor: () => void;
}) {
  const b = id !== null ? state.buildings.find((x) => x.id === id) : undefined;
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setConfirm(false), [id]);

  const def = b ? BUILDINGS[b.type] : null;
  const Icon = b ? BUILDING_ICONS[b.type] : null;

  return (
    <Modal
      open={!!b}
      onClose={onClose}
      code={b ? `${serialOf(b)} · ${cellName(b.x, b.y)}` : 'УЗЕЛ'}
      title={def ? def.name : 'Узел'}
      icon={Icon ?? undefined}
      color={def?.color}
      width="max-w-xl"
    >
      {b && def && Icon && renderBody()}
    </Modal>
  );

  // Обычная функция, а не компонент: иначе тело модалки пересоздавалось бы каждый тик.
  function renderBody() {
    if (!b || !def || !Icon) return null;
    const mods = getMods(state);
    const map = cellMap(state);
    const r = ratesOf(state, b, mods, map);
    const bf = state.flow.b[b.id];
    const status = bf?.status ?? 'idle';
    const out = mainOutput(b, r, state);
    const actual = bf ? bf.out : 0;
    const inputs = inputsOf(b, r);
    const energy = energyUse(b, mods);
    const maxed = b.level >= BAL.maxLevel;
    const upCost = maxed ? 0 : upgradeCost(b);
    const next = maxed ? null : ratesFor({ ...b, level: b.level + 1 }, mods, r.adj);
    const nextOut = next ? mainOutput({ ...b, level: b.level + 1 }, next, state) : null;
    const nextEnergy = maxed ? 0 : energyUse({ ...b, level: b.level + 1 }, mods);
    const hint = feedHint(b.type);
    const refund = refundOf(b);
    const actualLabel =
      b.type === 'publisher' || b.type === 'agi'
        ? money(actual)
        : b.type === 'storage'
          ? `+${num(out.value)}%`
          : num(actual);

    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div
            className="grid h-16 w-16 shrink-0 place-items-center rounded-lg border"
            style={{ borderColor: `${def.color}88`, background: `radial-gradient(circle, ${def.color}30, transparent 70%)` }}
          >
            <Icon size={32} color={def.color} strokeWidth={1.6} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge color={def.color}>Mk.{roman(b.level)}</Badge>
              <Badge color={STATUS_COLOR[status]}>{STATUS_LABEL[status]}</Badge>
              <span className="font-mono text-[10px] text-steel-500">{def.en}</span>
            </div>
            <p className="mt-1 text-[13px] leading-snug text-steel-300">{def.desc}</p>
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between font-mono text-[10px] text-steel-400">
            <span>ЗАГРУЗКА</span>
            <span className="num text-steel-200">{pct(bf?.u ?? 0)}</span>
          </div>
          <Meter value={bf?.u ?? 0} color={STATUS_COLOR[status]} label="Загрузка здания" />
          <p className="mt-1.5 text-[12px] text-steel-300">{LIMIT_TEXT[bf?.lim ?? 'none']}</p>
          {b.work < BAL.commissionTicks && (
            <p className="num mt-1 text-[11px] text-data">
              Пусконаладка: {b.work} / {BAL.commissionTicks} с — после неё узел попадёт в рекорд построек.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat
            label={out.label}
            value={`${actualLabel} ${b.type === 'publisher' || b.type === 'agi' || b.type === 'storage' ? '' : out.unit}`}
            sub={b.type === 'storage' ? undefined : `макс. ${b.type === 'publisher' || b.type === 'agi' ? money(out.value) : num(out.value)} ${out.unit}`}
            color={def.color}
          />
          {inputs && (
            <div className="col-span-2">
              <Stat label="Потребляет (макс.)" value={inputs} />
            </div>
          )}
          <Stat
            label={b.type === 'reactor' ? 'Отдаёт в сеть' : 'Энергия'}
            value={b.type === 'reactor' ? `+${num(r.gen)} МВт` : `−${num(b.enabled ? energy : 0)} МВт`}
            color="#facc15"
            sub={!b.enabled && b.type !== 'reactor' ? 'на паузе не тратит' : undefined}
          />
          {r.speed !== 1 || hint ? (
            <Stat
              label="Скорость"
              value={`×${num(r.speed)}`}
              sub={hint ? `соседей-поставщиков: ${r.adj}` : undefined}
              color="#22d3ee"
            />
          ) : null}
          <Stat label="Уровень" value={`×${num(levelOut(b.level))} выпуска`} sub={`Mk.${roman(b.level)} из Mk.${roman(BAL.maxLevel)}`} />
          {b.type === 'coder' && (
            <Stat
              label="КПД / техдолг"
              value={`${pct(bf?.eff ?? 1)} · ${Math.round(b.debt)}%`}
              color={b.debt >= 60 ? '#f43f5e' : b.debt >= 25 ? '#fb923c' : '#34d399'}
              sub="долг режет выход кода"
            />
          )}
        </div>

        {hint && (
          <p className="rounded border border-data/25 bg-data/5 px-3 py-2 text-[12px] leading-snug text-steel-300">
            Прямой конвейер: каждый соседний <span className="text-data">{hint}</span> даёт +
            {Math.round(BAL.adjBonus * 100)}% к скорости (до +{Math.round(BAL.adjBonus * BAL.adjMax * 100)}%).
          </p>
        )}

        {b.type === 'coder' && b.debt > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded border border-debt/30 bg-debt/5 px-3 py-2">
            <Bug size={16} className="text-debt" aria-hidden />
            <div className="min-w-0 flex-1 text-[12px] text-steel-300">
              Мусор в коде съедает {pct(1 - (bf?.eff ?? 1))} выпуска. Рефакторинг чистит все блоки сразу.
            </div>
            <button type="button" className="btn btn-warn" onClick={onRefactor}>
              <WandSparkles size={14} aria-hidden /> {money(refactorCost(state))}
            </button>
          </div>
        )}

        <div className="rounded-md border border-steel-700 bg-steel-900/70 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="font-display text-[12px] uppercase tracking-wider text-steel-100">
              {maxed ? `Максимальный уровень Mk.${roman(BAL.maxLevel)}` : `Улучшение до Mk.${roman(b.level + 1)}`}
            </div>
            {!maxed && (
              <span className={`num text-[13px] font-semibold ${state.credits >= upCost ? 'text-cash' : 'text-alert'}`}>
                {money(upCost)}
              </span>
            )}
          </div>
          {!maxed && next && nextOut && (
            <div className="num mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-steel-300">
              <span>
                {out.label}: {b.type === 'publisher' || b.type === 'agi' ? money(out.value) : num(out.value)} →{' '}
                <span style={{ color: def.color }}>
                  {b.type === 'publisher' || b.type === 'agi' ? money(nextOut.value) : num(nextOut.value)}
                </span>{' '}
                {b.type === 'publisher' || b.type === 'agi' ? '$/с' : out.unit}
              </span>
              <span>
                {b.type === 'reactor' ? 'Нагрузка' : 'Энергия'}: {b.type === 'reactor' ? '0' : num(energy)} →{' '}
                <span className="text-energy">{b.type === 'reactor' ? '0' : num(nextEnergy)}</span> МВт
              </span>
            </div>
          )}
          <button
            type="button"
            className="btn btn-primary mt-2.5 w-full"
            disabled={maxed || state.credits < upCost}
            onClick={() => onUpgrade(b.id)}
          >
            <ArrowUpCircle size={15} aria-hidden />
            {maxed ? 'Улучшать больше некуда' : state.credits >= upCost ? 'Улучшить' : `Не хватает ${money(upCost - state.credits)}`}
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button type="button" className={`btn ${b.enabled ? '' : 'btn-info'}`} onClick={() => onToggle(b.id)}>
            <Power size={14} aria-hidden /> {b.enabled ? 'Остановить' : 'Запустить'}
          </button>
          <button type="button" className="btn btn-info" onClick={() => onMove(b.id)}>
            <Move size={14} aria-hidden /> Перенести
          </button>
          <button type="button" className="btn btn-danger" onClick={() => setConfirm(true)}>
            <Trash2 size={14} aria-hidden /> Снести
          </button>
        </div>
        <AnimatePresence>
          {confirm && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="flex flex-wrap items-center gap-2 rounded border border-alert/40 bg-alert/10 px-3 py-2 text-[12px] text-steel-200">
                <span className="min-w-0 flex-1">
                  Демонтировать {serialOf(b)}? Вернём половину вложенного: {money(refund)}.
                </span>
                <button type="button" className="btn" onClick={() => setConfirm(false)}>
                  Отмена
                </button>
                <button type="button" className="btn btn-danger" onClick={() => onDemolish(b.id)}>
                  Демонтировать
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }
}
