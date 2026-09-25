import { motion } from 'framer-motion';
import { Lock } from 'lucide-react';
import { POTIONS, POTION_ORDER, SPELLS, SPELL_ORDER } from '../../game/constants';
import type { GameState, PotionId, SpellId } from '../../types';
import { POTION_ICONS, SPELL_ICONS } from '../ui/Icons';

interface QuickBarProps {
  state: GameState;
  active: boolean;
  onPotion: (id: PotionId) => void;
  onSpell: (id: SpellId) => void;
}

/** Пояс алхимика: зелья и заклинания, доступные прямо в бою. */
export function QuickBar({ state, active, onPotion, onSpell }: QuickBarProps) {
  return (
    <div className="wood-panel relative flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:p-4">
      <div className="relative flex flex-1 flex-wrap gap-2" role="group" aria-label="Зелья">
        {POTION_ORDER.map((id) => {
          const meta = POTIONS[id];
          const style = POTION_ICONS[id];
          const Icon = style.icon;
          const count = state.potions[id];
          return (
            <motion.button
              key={id}
              type="button"
              disabled={!active || count <= 0}
              onClick={() => onPotion(id)}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.95 }}
              title={`${meta.name}: ${meta.description}`}
              aria-label={`Использовать: ${meta.name} (${count})`}
              className="focus-brass group relative flex cursor-pointer items-center gap-2 rounded-xl border border-amber-700/35 bg-black/30 py-1.5 pr-3 pl-1.5 transition-colors hover:border-amber-400/60 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="relative grid h-9 w-9 place-items-center overflow-hidden rounded-lg border border-amber-500/30 bg-black/40">
                <span className={`absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t opacity-70 ${style.liquid}`} />
                <Icon size={17} className={`relative ${style.color}`} />
              </span>
              <span className="text-left leading-tight">
                <span className="block font-display text-[13px] font-bold text-amber-50">{meta.short}</span>
                <span className="font-mono text-xs text-amber-200/70">×{count}</span>
              </span>
            </motion.button>
          );
        })}
      </div>

      <div className="relative flex flex-wrap gap-2 border-t border-amber-700/25 pt-3 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-4" role="group" aria-label="Заклинания">
        {SPELL_ORDER.map((id) => {
          const meta = SPELLS[id];
          const Icon = SPELL_ICONS[id];
          const unlocked = state.player.level >= meta.unlockLevel;
          const enough = state.player.mana >= meta.mana;
          return (
            <motion.button
              key={id}
              type="button"
              disabled={!active || !unlocked || !enough}
              onClick={() => onSpell(id)}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.95 }}
              title={`${meta.name}: ${meta.description}${unlocked ? '' : ` Откроется на ${meta.unlockLevel} уровне.`}`}
              aria-label={`Заклинание: ${meta.name}, ${meta.mana} маны`}
              className="focus-brass flex cursor-pointer items-center gap-2 rounded-xl border border-sky-500/35 bg-sky-950/30 px-2.5 py-1.5 transition-colors hover:border-sky-300/70 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {unlocked ? <Icon size={17} className="text-sky-200" /> : <Lock size={15} className="text-amber-200/60" />}
              <span className="text-left leading-tight">
                <span className="block font-display text-[13px] font-bold text-sky-50">{meta.short}</span>
                <span className="font-mono text-xs text-sky-300/80">{meta.mana} маны</span>
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
