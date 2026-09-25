import { motion } from 'framer-motion';
import { Castle, Coins, Flame, Heart, Keyboard, Moon, Sparkles, Swords, Timer, Zap } from 'lucide-react';
import { ELEMENTS, ELEMENT_META, HUNT_TIERS, meditationCost } from '../../game/constants';
import { TOWER } from '../../game/enemies';
import type { GameState, HuntTier, TabId } from '../../types';
import type { Derived, GameActions, GameFx } from '../../hooks/useGame';
import { Button } from '../ui/Button';
import { ELEMENT_ICONS, ELEMENT_STYLE, ENEMY_ICONS } from '../ui/Icons';
import { Meter } from '../ui/Meter';
import { Panel } from '../ui/Panel';
import { PlayerCard } from './Combatants';

interface ArenaLobbyProps {
  state: GameState;
  derived: Derived;
  actions: GameActions;
  fx: GameFx;
  onNavigate: (tab: TabId) => void;
}

const TIER_ORDER: HuntTier[] = ['easy', 'normal', 'hard'];
const TIER_ACCENT: Record<HuntTier, string> = {
  easy: 'text-emerald-300',
  normal: 'text-amber-300',
  hard: 'text-red-300',
};

/** Лагерь перед боем: выбор охоты, восстановление, быстрый переход к башне и блицу. */
export function ArenaLobby({ state, derived, actions, fx, onNavigate }: ArenaLobbyProps) {
  const { player } = state;
  const cost = meditationCost(player.level);
  const full = player.hp >= derived.maxHp && player.mana >= derived.maxMana;
  const nextFloor = Math.min(10, state.campaignCleared + 1);
  const boss = TOWER[nextFloor - 1];
  const BossIcon = boss ? ENEMY_ICONS[boss.icon] : Castle;
  const best = state.records[0];
  const lowHp = player.hp < derived.maxHp * 0.35;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      <div className="flex flex-col gap-4">
        <PlayerCard player={player} maxHp={derived.maxHp} maxMana={derived.maxMana} battle={null} floaters={fx.floaters} shakeKey={fx.playerShake} potionFx={fx.potionFx} />
        <Panel title="Привал" icon={<Moon size={15} />} delay={0.05}>
          <Meter tone="xp" label="Опыт" icon={<Sparkles size={12} />} value={player.xp} max={derived.xpNeeded} valueText={`${player.xp} / ${derived.xpNeeded}`} />
          <p className="mt-3 text-sm text-amber-100/75">
            Медитация у горна полностью восстанавливает здоровье и ману.
            {lowHp && <span className="text-red-300"> Здоровье на исходе — отдохните перед боем.</span>}
          </p>
          <Button className="mt-3 w-full" variant="emerald" icon={<Moon size={16} />} disabled={full || player.gold < cost} onClick={actions.meditate}>
            Медитировать · <Coins size={14} /> <span className="font-mono">{cost}</span>
          </Button>
          <div className="mt-4 rounded-lg border border-amber-700/25 bg-black/20 p-3 text-xs text-amber-200/70">
            <p className="flex items-center gap-1.5 font-display font-bold text-amber-200">
              <Keyboard size={13} /> Как творить магию
            </p>
            <p className="mt-1">
              Решите пример в Горне и нажмите Enter или «Применить». Быстрый ответ бьёт сильнее, серия верных — копит комбо. Ошибка или
              истёкший таймер — удар врага.
            </p>
          </div>
        </Panel>
      </div>

      <div className="flex flex-col gap-4">
        <Panel title="Охота за эссенциями" icon={<Swords size={15} />} delay={0.08}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {TIER_ORDER.map((tier, i) => {
              const meta = HUNT_TIERS[tier];
              const level = Math.max(1, player.level + meta.levelDelta);
              return (
                <motion.div
                  key={tier}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 + i * 0.06 }}
                  whileHover={{ y: -3 }}
                  className="glass-vial flex flex-col gap-2 p-4"
                >
                  <p className={`font-display text-lg font-bold ${TIER_ACCENT[tier]}`}>{meta.label}</p>
                  <p className="text-sm text-amber-100/70">{meta.description}</p>
                  <p className="font-mono text-xs text-amber-200/60">Враг ур. {level}</p>
                  <Button
                    className="mt-auto"
                    variant={tier === 'hard' ? 'danger' : 'brass'}
                    icon={<Swords size={15} />}
                    disabled={player.hp <= 0}
                    onClick={() => actions.startHunt(tier)}
                  >
                    В бой
                  </Button>
                </motion.div>
              );
            })}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
            {ELEMENTS.map((el) => {
              const Icon = ELEMENT_ICONS[el];
              const meta = ELEMENT_META[el];
              const locked = player.level < meta.unlockLevel;
              return (
                <div key={el} className={`rounded-lg border px-3 py-2 ${ELEMENT_STYLE[el].soft} ${locked ? 'opacity-50' : ''}`}>
                  <p className={`flex items-center gap-1.5 font-display text-sm font-bold ${ELEMENT_STYLE[el].text}`}>
                    <Icon size={14} /> {meta.name}
                  </p>
                  <p className="text-xs text-amber-100/70">{meta.operation}</p>
                  <p className="font-mono text-[11px] text-amber-200/60">
                    {locked ? `с ${meta.unlockLevel} уровня` : `урон ${meta.baseDamage} · +${meta.extraTime} с`}
                  </p>
                </div>
              );
            })}
          </div>
        </Panel>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Panel title="Башня Испытаний" icon={<Castle size={15} />} delay={0.14}>
            {state.campaignCleared >= 10 ? (
              <p className="text-sm text-amber-100/80">Все 10 этажей покорены. Архимаг Пустоты повержен — но боссов можно побеждать снова ради эссенций.</p>
            ) : boss ? (
              <div className="flex items-start gap-3">
                <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-fuchsia-400/50 bg-fuchsia-950/60">
                  <BossIcon size={26} className="text-fuchsia-200" />
                </div>
                <div className="min-w-0">
                  <p className="font-mono text-xs text-amber-200/60">Этаж {nextFloor} · ур. {boss.level}</p>
                  <p className="font-display text-base font-bold text-amber-50">{boss.name}</p>
                  <p className="mt-1 text-xs text-amber-100/70">{boss.rule}</p>
                </div>
              </div>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              {state.campaignCleared < 10 && (
                <Button variant="arcane" icon={<Flame size={15} />} onClick={() => actions.startFloor(nextFloor)} disabled={player.hp <= 0}>
                  Бросить вызов
                </Button>
              )}
              <Button variant="ghost" onClick={() => onNavigate('tower')}>
                Все этажи
              </Button>
            </div>
          </Panel>

          <Panel title="Математический Блиц" icon={<Timer size={15} />} delay={0.18}>
            <p className="text-sm text-amber-100/75">60 секунд, +3 секунды за каждый верный ответ. Сколько очков вы успеете набрать?</p>
            <p className="mt-2 font-mono text-sm text-amber-200">Рекорд: {best ? `${best.score} очков` : 'ещё нет'}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="brass" icon={<Zap size={15} />} onClick={() => actions.startBlitz('chaos')}>
                Блиц «Хаос»
              </Button>
              <Button variant="ghost" onClick={() => onNavigate('tower')}>
                Выбрать школу
              </Button>
            </div>
          </Panel>
        </div>

        {player.hp <= 0 && (
          <p className="flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-2 text-sm text-red-200">
            <Heart size={15} /> Без здоровья в бой не выйти — помедитируйте или выпейте зелье.
          </p>
        )}
      </div>
    </div>
  );
}
