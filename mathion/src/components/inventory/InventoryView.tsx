import { motion } from 'framer-motion';
import { Backpack, BarChart3, BookOpen, Gem, Lock, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { ELEMENTS, ELEMENT_META, POTIONS, POTION_ORDER, SPELLS, SPELL_ORDER, UPGRADES, UPGRADE_ORDER } from '../../game/constants';
import type { GameState, TabId } from '../../types';
import type { Derived, GameActions } from '../../hooks/useGame';
import { Button } from '../ui/Button';
import { ELEMENT_STYLE, ElementIcon, POTION_ICONS, SPELL_ICONS, UPGRADE_ICONS } from '../ui/Icons';
import { ConfirmDialog } from '../ui/Modal';
import { Panel } from '../ui/Panel';

interface InventoryViewProps {
  state: GameState;
  derived: Derived;
  actions: GameActions;
  onNavigate: (tab: TabId) => void;
}

export function InventoryView({ state, derived, actions, onNavigate }: InventoryViewProps) {
  const [confirmReset, setConfirmReset] = useState(false);
  const inCombat = state.battle?.status === 'active' || state.blitz?.status === 'active';
  const owned = UPGRADE_ORDER.filter((id) => state.upgrades[id] > 0);
  const { stats } = state;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Panel title="Экипированные артефакты" icon={<Gem size={15} />}>
        {owned.length === 0 ? (
          <div className="rounded-lg border border-dashed border-amber-700/40 px-4 py-6 text-center text-sm text-amber-200/65">
            Артефактов пока нет.{' '}
            <button type="button" className="focus-brass cursor-pointer text-amber-300 underline underline-offset-4" onClick={() => onNavigate('lab')}>
              Загляните в лабораторию
            </button>
            .
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {owned.map((id, i) => {
              const meta = UPGRADES[id];
              const Icon = UPGRADE_ICONS[id];
              return (
                <motion.li
                  key={id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="glass-vial flex items-center gap-3 p-3"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-amber-300/60 bg-amber-500/15 text-amber-200 shadow-[0_0_14px_rgba(240,200,114,0.5)]">
                    <Icon size={18} />
                  </span>
                  <div className="min-w-0">
                    <p className="font-display text-sm font-bold text-amber-50">
                      {meta.name} <span className="font-mono text-xs text-amber-300">ур. {state.upgrades[id]}</span>
                    </p>
                    <p className="text-xs text-emerald-300">{meta.effect(state.upgrades[id])}</p>
                  </div>
                </motion.li>
              );
            })}
          </ul>
        )}
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <Mini label="Шанс крита" value={`${Math.round(derived.critChance * 100)}%`} />
          <Mini label="Сила крита" value={`×${derived.critMultiplier.toFixed(2)}`} />
          <Mini label="Блок урона" value={`${Math.round(derived.shieldBlock * 100)}%`} />
          <Mini label="Доп. время" value={`+${derived.lensesBonus} с`} />
        </dl>
      </Panel>

      <Panel title="Сумка зелий" icon={<Backpack size={15} />} delay={0.05}>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {POTION_ORDER.map((id) => {
            const meta = POTIONS[id];
            const style = POTION_ICONS[id];
            const Icon = style.icon;
            const usable = state.potions[id] > 0 && !meta.battleOnly && !inCombat;
            return (
              <li key={id} className="glass-vial flex items-center gap-3 p-3">
                <span className="relative grid h-12 w-10 shrink-0 place-items-center overflow-hidden rounded-b-xl rounded-t-md border border-amber-500/40 bg-black/50">
                  <span className={`absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t opacity-80 ${style.liquid}`} />
                  <Icon size={16} className={`relative ${style.color}`} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-sm font-bold text-amber-50">
                    {meta.name} <span className="font-mono text-xs text-amber-300">×{state.potions[id]}</span>
                  </p>
                  <p className="text-xs text-amber-100/65">{meta.battleOnly ? 'Только в бою' : meta.description}</p>
                </div>
                {!meta.battleOnly && (
                  <Button size="sm" variant="emerald" disabled={!usable} onClick={() => actions.usePotion(id)} aria-label={`Выпить: ${meta.name}`}>
                    Выпить
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        {inCombat && <p className="mt-3 text-xs text-amber-200/60">Во время боя зелья пьются с пояса на арене.</p>}
      </Panel>

      <Panel title="Книга заклинаний" icon={<BookOpen size={15} />} delay={0.1}>
        <ul className="space-y-2">
          {SPELL_ORDER.map((id) => {
            const meta = SPELLS[id];
            const Icon = SPELL_ICONS[id];
            const unlocked = state.player.level >= meta.unlockLevel;
            const castable = id === 'regen' && unlocked && state.player.mana >= meta.mana && !inCombat && state.player.hp < derived.maxHp;
            return (
              <li key={id} className={`glass-vial flex items-center gap-3 p-3 ${unlocked ? '' : 'opacity-55'}`}>
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border ${ELEMENT_STYLE[meta.element].soft}`}>
                  {unlocked ? <Icon size={18} className={ELEMENT_STYLE[meta.element].text} /> : <Lock size={16} className="text-amber-200/60" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-sm font-bold text-amber-50">
                    {meta.name} <span className="font-mono text-xs text-sky-300">{meta.mana} маны</span>
                  </p>
                  <p className="text-xs text-amber-100/65">{unlocked ? meta.description : `Откроется на ${meta.unlockLevel} уровне.`}</p>
                </div>
                {id === 'regen' && (
                  <Button size="sm" variant="emerald" disabled={!castable} onClick={() => actions.castSpell(id)}>
                    Прочесть
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {ELEMENTS.map((el) => (
            <div key={el} className={`rounded-lg border px-3 py-2 ${ELEMENT_STYLE[el].soft}`}>
              <p className="flex items-center gap-1.5 text-xs text-amber-100/80">
                <ElementIcon element={el} size={13} /> {ELEMENT_META[el].essence.replace('Эссенция ', '')}
              </p>
              <p className="font-mono text-xl font-bold text-amber-50">{state.player.essences[el]}</p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Летопись алхимика" icon={<BarChart3 size={15} />} delay={0.15}>
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          <Mini label="Побед" value={String(stats.battlesWon)} />
          <Mini label="Поражений" value={String(stats.battlesLost)} />
          <Mini label="Боссов повержено" value={String(stats.bossesSlain)} />
          <Mini label="Всего урона" value={String(stats.totalDamage)} />
          <Mini label="Лучший удар" value={String(stats.bestHit)} />
          <Mini label="Критов" value={String(stats.crits)} />
        </dl>
        <h3 className="mt-4 mb-2 font-display text-sm font-bold text-amber-200">Точность по школам</h3>
        <ul className="space-y-2">
          {ELEMENTS.map((el) => {
            const s = stats.byElement[el];
            const total = s.correct + s.wrong;
            const pct = total > 0 ? Math.round((s.correct / total) * 100) : 0;
            return (
              <li key={el} className="flex items-center gap-3 text-sm">
                <span className="flex w-24 shrink-0 items-center gap-1.5 text-amber-100">
                  <ElementIcon element={el} size={13} /> {ELEMENT_META[el].name}
                </span>
                <span className="relative h-2 flex-1 overflow-hidden rounded-full border border-amber-700/40 bg-black/50">
                  <motion.span
                    className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-amber-300 to-amber-600"
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.8 }}
                  />
                </span>
                <span className="w-24 shrink-0 text-right font-mono text-xs text-amber-200/80">
                  {total > 0 ? `${pct}% · ${s.correct}/${total}` : '—'}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="mt-6 rounded-lg border border-red-500/30 bg-red-950/20 p-3">
          <p className="text-sm text-red-200">Начать путь заново: прогресс, предметы и рекорды будут стёрты.</p>
          <Button className="mt-2" size="sm" variant="danger" icon={<RotateCcw size={14} />} onClick={() => setConfirmReset(true)}>
            Сбросить игру
          </Button>
        </div>
      </Panel>

      <ConfirmDialog
        open={confirmReset}
        title="Сбросить всю игру?"
        message="Уровень, золото, эссенции, артефакты, зелья, этажи башни и рекорды блица будут удалены без возможности восстановления."
        confirmLabel="Сбросить"
        onConfirm={actions.resetGame}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-amber-700/30 bg-black/25 px-3 py-2">
      <dt className="text-xs text-amber-200/60">{label}</dt>
      <dd className="font-mono font-bold text-amber-50">{value}</dd>
    </div>
  );
}
