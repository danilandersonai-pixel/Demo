import { motion } from 'framer-motion';
import { ArrowDown, BookOpen, Check, Coins, FlaskConical, Lock, Network } from 'lucide-react';
import { POTIONS, POTION_ORDER, POTION_STACK, UPGRADES } from '../../game/constants';
import { canBuyUpgrade, canCraft } from '../../game/engine';
import type { GameState, PotionId, UpgradeId } from '../../types';
import type { GameActions } from '../../hooks/useGame';
import { Button } from '../ui/Button';
import { EssenceRow, POTION_ICONS, UPGRADE_ICONS } from '../ui/Icons';
import { Panel } from '../ui/Panel';

interface LabViewProps {
  state: GameState;
  actions: GameActions;
}

/** Ветви дерева: корень сверху, продвинутый узел снизу. */
const BRANCHES: Array<{ title: string; nodes: [UpgradeId, UpgradeId] }> = [
  { title: 'Ветвь Трансмутации', nodes: ['stone', 'codex'] },
  { title: 'Ветвь Прозрения', nodes: ['lenses', 'crystal'] },
  { title: 'Ветвь Стойкости', nodes: ['shield', 'amulet'] },
];

export function LabView({ state, actions }: LabViewProps) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <Panel title="Дерево Числовой Алхимии" icon={<Network size={15} />}>
        <p className="mb-4 text-sm text-amber-100/70">
          Постоянные улучшения за золото и эссенции. Нижний узел ветви открывается после первого уровня верхнего.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {BRANCHES.map((branch, i) => (
            <div key={branch.title} className="flex flex-col items-stretch">
              <p className="mb-2 text-center font-display text-sm font-bold text-amber-300/80">{branch.title}</p>
              <UpgradeNode id={branch.nodes[0]} state={state} onBuy={actions.buyUpgrade} delay={0.05 + i * 0.05} />
              <div className="flex justify-center py-1.5" aria-hidden="true">
                <ArrowDown size={18} className={state.upgrades[branch.nodes[0]] > 0 ? 'text-amber-300' : 'text-amber-800'} />
              </div>
              <UpgradeNode id={branch.nodes[1]} state={state} onBuy={actions.buyUpgrade} delay={0.1 + i * 0.05} />
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Книга рецептов" icon={<BookOpen size={15} />} delay={0.08}>
        <p className="mb-4 text-sm text-amber-100/70">Одноразовые зелья. Пить можно прямо в бою — с пояса под Горном. В запасе не больше {POTION_STACK} каждого.</p>
        <ul className="space-y-3">
          {POTION_ORDER.map((id, i) => (
            <RecipeCard key={id} id={id} state={state} onCraft={actions.craftPotion} index={i} />
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function UpgradeNode({ id, state, onBuy, delay }: { id: UpgradeId; state: GameState; onBuy: (id: UpgradeId) => void; delay: number }) {
  const meta = UPGRADES[id];
  const Icon = UPGRADE_ICONS[id];
  const level = state.upgrades[id];
  const maxed = level >= meta.maxLevel;
  const locked = meta.requires !== null && state.upgrades[meta.requires.id] < meta.requires.level;
  const check = canBuyUpgrade(state, id);
  const cost = maxed ? null : meta.cost(level + 1);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      whileHover={{ y: -2 }}
      className={`glass-vial flex flex-col gap-2 p-3 ${locked ? 'opacity-55' : ''} ${level > 0 ? 'border-amber-400/40 shadow-[0_0_24px_-12px_rgba(240,200,114,0.9)]' : ''}`}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border ${
            level > 0 ? 'border-amber-300/70 bg-amber-500/20 text-amber-200 shadow-[0_0_14px_rgba(240,200,114,0.6)]' : 'border-amber-700/40 bg-black/40 text-amber-200/50'
          }`}
        >
          {locked ? <Lock size={16} /> : <Icon size={18} />}
        </span>
        <div className="min-w-0">
          <p className="font-display text-[15px] leading-tight font-bold text-amber-50">{meta.name}</p>
          <p className="font-mono text-xs text-amber-300/80">
            ур. {level}/{meta.maxLevel}
          </p>
        </div>
      </div>
      <div className="flex gap-1" aria-hidden="true">
        {Array.from({ length: meta.maxLevel }, (_, i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full ${i < level ? 'bg-gradient-to-r from-amber-300 to-amber-500 shadow-[0_0_6px_rgba(240,200,114,0.8)]' : 'bg-black/50'}`} />
        ))}
      </div>
      <p className="text-xs text-amber-100/70">{meta.description}</p>
      <p className="text-xs text-emerald-300">{level > 0 ? `Сейчас: ${meta.effect(level)}` : 'Не изучено'}</p>
      {!maxed && <p className="text-xs text-amber-200/60">Следующий: {meta.effect(level + 1)}</p>}
      {cost && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={`inline-flex items-center gap-1 font-mono ${state.player.gold < cost.gold ? 'text-red-400' : 'text-amber-200'}`}>
            <Coins size={12} /> {cost.gold}
          </span>
          <EssenceRow essences={cost.essences} have={state.player.essences} size="sm" />
        </div>
      )}
      <Button
        size="sm"
        variant={maxed ? 'ghost' : 'brass'}
        disabled={!check.ok}
        onClick={() => onBuy(id)}
        icon={maxed ? <Check size={14} /> : undefined}
        aria-label={`Улучшить: ${meta.name}`}
      >
        {maxed ? 'Максимум' : check.ok ? (level === 0 ? 'Изучить' : 'Улучшить') : check.reason}
      </Button>
    </motion.div>
  );
}

function RecipeCard({ id, state, onCraft, index }: { id: PotionId; state: GameState; onCraft: (id: PotionId) => void; index: number }) {
  const meta = POTIONS[id];
  const style = POTION_ICONS[id];
  const Icon = style.icon;
  const check = canCraft(state, id);
  return (
    <motion.li
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.1 + index * 0.05 }}
      className="glass-vial flex items-center gap-3 p-3"
    >
      <span className="relative grid h-14 w-12 shrink-0 place-items-center overflow-hidden rounded-b-2xl rounded-t-md border border-amber-500/40 bg-black/50">
        <span className={`absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t opacity-80 ${style.liquid}`} />
        <span className="absolute bottom-2 left-2 h-1.5 w-1.5 animate-bubble rounded-full bg-white/70" />
        <span className="absolute right-3 bottom-3 h-1 w-1 animate-bubble rounded-full bg-white/60 [animation-delay:1.1s]" />
        <Icon size={18} className={`relative ${style.color}`} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-[15px] font-bold text-amber-50">
          {meta.name} <span className="font-mono text-xs font-normal text-amber-300/80">×{state.potions[id]}</span>
        </p>
        <p className="text-xs text-amber-100/70">{meta.description}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <span className={`inline-flex items-center gap-1 font-mono ${state.player.gold < meta.gold ? 'text-red-400' : 'text-amber-200'}`}>
            <Coins size={12} /> {meta.gold}
          </span>
          <EssenceRow essences={meta.essences} have={state.player.essences} size="sm" />
        </div>
      </div>
      <Button size="sm" variant="emerald" icon={<FlaskConical size={14} />} disabled={!check.ok} onClick={() => onCraft(id)} title={check.reason ?? undefined} aria-label={`Сварить: ${meta.name}`}>
        Сварить
      </Button>
    </motion.li>
  );
}
