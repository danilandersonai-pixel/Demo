import { AnimatePresence, motion } from 'framer-motion';
import { Castle, Coins, Flag, Pause, Play, Skull, Sparkles, Trophy } from 'lucide-react';
import { useState } from 'react';
import { ELEMENT_META } from '../../game/constants';
import { getFloor } from '../../game/enemies';
import { isElementUnlocked } from '../../game/engine';
import type { Battle, GameState, HuntTier, TabId } from '../../types';
import type { Derived, GameActions, GameFx, Projectile } from '../../hooks/useGame';
import { Button } from '../ui/Button';
import { ELEMENT_STYLE, EssenceRow } from '../ui/Icons';
import { ConfirmDialog, Modal } from '../ui/Modal';
import { EnemyCard, PlayerCard } from './Combatants';
import { Forge } from './Forge';
import { QuickBar } from './QuickBar';

interface BattleViewProps {
  state: GameState;
  battle: Battle;
  derived: Derived;
  actions: GameActions;
  fx: GameFx;
  paused: boolean;
  onNavigate: (tab: TabId) => void;
}

/** Огненный шар заклинания, летящий от героя к врагу (на широких экранах). */
function SpellProjectiles({ projectiles }: { projectiles: Projectile[] }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-30 hidden lg:block" aria-hidden="true">
      <AnimatePresence>
        {projectiles.map((p) => (
          <motion.span
            key={p.id}
            className={`absolute top-[26%] h-5 w-5 rounded-full ${ELEMENT_STYLE[p.element].orb}`}
            initial={{ left: '14%', opacity: 0, scale: 0.4 }}
            animate={{ left: '84%', opacity: [0, 1, 1, 0.2], scale: [0.4, 1.2, 1, 1.8] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.55, ease: 'easeIn' }}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ruleFor(battle: Battle): string | null {
  if (battle.enemy.traits.includes('even_only')) return 'Близнецы принимают только чётные ответы.';
  if (battle.enemy.traits.includes('void_only')) return 'Печать Пустоты: другие школы наносят лишь 25% урона.';
  if (battle.enemy.traits.includes('chrono')) return 'Хронофаг пожирает время: таймер вдвое короче.';
  return null;
}

export function BattleView({ state, battle, derived, actions, fx, paused, onNavigate }: BattleViewProps) {
  const [confirmFlee, setConfirmFlee] = useState(false);
  const active = battle.status === 'active' && !paused;
  const title =
    battle.mode === 'campaign' && battle.floor !== null ? `Башня · этаж ${battle.floor}` : `Охота · ${battle.huntTier === 'hard' ? 'Проклятые руины' : battle.huntTier === 'easy' ? 'Тихая тропа' : 'Лесная чаща'}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-display text-lg font-bold text-amber-100 gold-glow">
          {battle.mode === 'campaign' ? <Castle size={18} className="text-amber-300" /> : <Sparkles size={18} className="text-emerald-300" />}
          {title}
          <span className="font-mono text-xs font-normal text-amber-200/50">ход {battle.turn}</span>
        </p>
        <div className="flex gap-2">
          {battle.status === 'active' && (
            <Button
              size="sm"
              variant="wood"
              icon={paused ? <Play size={14} /> : <Pause size={14} />}
              onClick={paused ? actions.resume : actions.pause}
            >
              {paused ? 'Продолжить' : 'Пауза'}
            </Button>
          )}
          {battle.status === 'active' && (
            <Button size="sm" variant="danger" icon={<Flag size={14} />} onClick={() => setConfirmFlee(true)}>
              Отступить
            </Button>
          )}
        </div>
      </div>

      <div className="relative grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)]">
        <SpellProjectiles projectiles={fx.projectiles} />
        <div className="order-3 lg:order-1">
          <PlayerCard
            player={state.player}
            maxHp={derived.maxHp}
            maxMana={derived.maxMana}
            battle={battle}
            floaters={fx.floaters}
            shakeKey={fx.playerShake}
            potionFx={fx.potionFx}
          />
        </div>

        <div className="wood-panel relative order-2 p-4 sm:p-5 lg:order-2">
          <p className="brass-plaque relative mx-auto mb-4 w-fit rounded-md px-4 py-1 text-center font-display text-sm font-bold tracking-wide">Алхимический Горн</p>
          <div className="relative">
            <Forge
              problem={battle.problem}
              timeLeft={battle.timeLeft}
              timeLimit={battle.timeLimit}
              frozenMs={battle.freezeLeft}
              active={active}
              onSubmit={actions.submitAnswer}
              selectedElement={battle.element}
              onSelectElement={actions.selectElement}
              isUnlocked={(el) => isElementUnlocked(state, el)}
              rule={ruleFor(battle)}
            />
            <AnimatePresence>
              {paused && battle.status === 'active' && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute -inset-2 z-20 flex flex-col items-center justify-center gap-3 rounded-xl bg-[#0c111a]/92 text-center backdrop-blur-md"
                >
                  <Pause size={36} className="text-amber-300" />
                  <p className="font-display text-xl font-bold text-amber-100">Бой на паузе</p>
                  <p className="max-w-xs text-sm text-amber-200/60">Пример скрыт, таймер остановлен. Бой ставится на паузу, если уйти с арены или свернуть вкладку.</p>
                  <Button variant="brass" icon={<Play size={16} />} onClick={actions.resume}>
                    Продолжить бой
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="order-1 lg:order-3">
          <EnemyCard
            enemy={battle.enemy}
            timeLeft={battle.timeLeft}
            timeLimit={battle.timeLimit}
            frozen={battle.freezeLeft > 0}
            floaters={fx.floaters}
            hitKey={fx.enemyShake}
          />
        </div>
      </div>

      <QuickBar state={state} active={active} onPotion={actions.usePotion} onSpell={actions.castSpell} />

      <BattleResult state={state} battle={battle} actions={actions} onNavigate={onNavigate} />
      <ConfirmDialog
        open={confirmFlee}
        title="Отступить?"
        message={`Бой с «${battle.enemy.name}» будет прерван без награды, а в спешке вы обронете 5% золота (${Math.floor(state.player.gold * 0.05)}).`}
        confirmLabel="Отступить"
        onConfirm={actions.flee}
        onCancel={() => setConfirmFlee(false)}
      />
    </div>
  );
}

function BattleResult({ state, battle, actions, onNavigate }: { state: GameState; battle: Battle; actions: GameActions; onNavigate: (tab: TabId) => void }) {
  const open = battle.status !== 'active';
  const victory = battle.status === 'victory';
  const total = battle.correct + battle.wrong;
  const accuracy = total > 0 ? Math.round((battle.correct / total) * 100) : 0;
  const nextFloor = battle.floor !== null && battle.floor < 10 && battle.floor + 1 <= state.campaignCleared + 1 ? battle.floor + 1 : null;
  const huntTier: HuntTier = battle.huntTier ?? 'normal';

  return (
    <Modal
      open={open}
      persistent
      title={victory ? 'Победа!' : 'Поражение'}
      icon={victory ? <Trophy size={22} className="text-amber-300" /> : <Skull size={22} className="text-red-400" />}
      footer={
        victory ? (
          <>
            {battle.mode === 'campaign' ? (
              <>
                <Button
                  variant="wood"
                  icon={<Castle size={15} />}
                  onClick={() => {
                    actions.closeBattle();
                    onNavigate('tower');
                  }}
                >
                  К башне
                </Button>
                {nextFloor && (
                  <Button
                    variant="brass"
                    data-autofocus
                    onClick={() => {
                      actions.closeBattle();
                      actions.startFloor(nextFloor);
                    }}
                  >
                    Этаж {nextFloor}
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button variant="wood" onClick={actions.closeBattle}>
                  В лагерь
                </Button>
                <Button
                  variant="brass"
                  data-autofocus
                  onClick={() => {
                    actions.closeBattle();
                    actions.startHunt(huntTier);
                  }}
                >
                  Следующий бой
                </Button>
              </>
            )}
          </>
        ) : (
          <Button variant="brass" data-autofocus onClick={actions.closeBattle}>
            Вернуться в лабораторию
          </Button>
        )
      }
    >
      <div className="space-y-4">
        <p className="text-[15px] text-amber-50/85">
          {victory
            ? `${battle.enemy.name} рассыпается на цифры.${battle.rewards?.firstClear ? ' Этаж башни покорён впервые!' : ''}`
            : `${battle.enemy.name} оказался сильнее. Вы теряете ${battle.goldLost} золота и приходите в себя с половиной здоровья.`}
        </p>

        {victory && battle.rewards && (
          <div className="glass-vial space-y-2 p-3">
            <p className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-1.5 text-amber-200">
                <Coins size={15} /> Золото
              </span>
              <span className="font-mono font-bold text-amber-100">+{battle.rewards.gold}</span>
            </p>
            <p className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-1.5 text-amber-200">
                <Sparkles size={15} /> Опыт
              </span>
              <span className="font-mono font-bold text-amber-100">+{battle.rewards.xp}</span>
            </p>
            <p className="flex items-center justify-between text-sm">
              <span className="text-amber-200">Эссенции</span>
              <EssenceRow essences={battle.rewards.essences} hideEmpty size="sm" />
            </p>
          </div>
        )}

        <dl className="grid grid-cols-2 gap-2 text-sm">
          <Stat label="Верных ответов" value={`${battle.correct} из ${total}`} />
          <Stat label="Точность" value={`${accuracy}%`} />
          <Stat label="Лучшее комбо" value={`×${battle.maxCombo}`} />
          <Stat label="Урон нанесён / получен" value={`${battle.damageDealt} / ${battle.damageTaken}`} />
        </dl>

        {battle.mode === 'campaign' && battle.floor !== null && !victory && (
          <p className="text-sm text-amber-200/70 italic">Совет: {getFloor(battle.floor).rule} Улучшите Ментальный щит или сварите зелья в лаборатории.</p>
        )}
        {victory && battle.enemy.weakness && (
          <p className="text-xs text-amber-200/55">
            Подсказка: {battle.enemy.name} был уязвим к школе «{ELEMENT_META[battle.enemy.weakness].name}».
          </p>
        )}
      </div>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-amber-700/30 bg-black/25 px-3 py-2">
      <dt className="text-xs text-amber-200/60">{label}</dt>
      <dd className="font-mono font-bold text-amber-50">{value}</dd>
    </div>
  );
}
