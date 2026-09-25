import { motion } from 'framer-motion';
import { Castle, Check, Coins, Crown, Lock, Swords, Timer, Trophy, Zap } from 'lucide-react';
import { useState } from 'react';
import { ELEMENTS, ELEMENT_META } from '../../game/constants';
import { TOWER, TRAIT_META } from '../../game/enemies';
import { isElementUnlocked } from '../../game/engine';
import type { BlitzElement, GameState } from '../../types';
import type { GameActions } from '../../hooks/useGame';
import { Button } from '../ui/Button';
import { ELEMENT_ICONS, ELEMENT_STYLE, ENEMY_ICONS, ElementIcon } from '../ui/Icons';
import { Panel } from '../ui/Panel';

interface TowerViewProps {
  state: GameState;
  actions: GameActions;
  onStart: () => void;
}

const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function TowerView({ state, actions, onStart }: TowerViewProps) {
  const nextFloor = Math.min(10, state.campaignCleared + 1);
  const [selected, setSelected] = useState(nextFloor);
  const [blitzChoice, setBlitzChoice] = useState<BlitzElement>('chaos');
  const boss = TOWER[selected - 1];
  const busy = state.battle !== null || state.blitz !== null;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <Panel title="Башня Испытаний" icon={<Castle size={15} />}>
        <p className="mb-4 text-sm text-amber-100/70">
          Десять этажей, на каждом — босс со своим правилом. Этажи открываются по порядку. Пройдено: <span className="font-mono text-amber-200">{state.campaignCleared}/10</span>.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <ol className="flex flex-col-reverse gap-1.5" aria-label="Этажи башни">
            {TOWER.map((floor) => {
              const cleared = floor.floor <= state.campaignCleared;
              const available = floor.floor <= state.campaignCleared + 1;
              const Icon = ENEMY_ICONS[floor.icon];
              const isSelected = floor.floor === selected;
              return (
                <li key={floor.floor}>
                  <motion.button
                    type="button"
                    onClick={() => setSelected(floor.floor)}
                    whileHover={{ x: 3 }}
                    whileTap={{ scale: 0.97 }}
                    aria-pressed={isSelected}
                    className={`focus-brass flex w-full cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                      isSelected
                        ? 'border-amber-300/70 bg-amber-500/15 shadow-[0_0_18px_-8px_rgba(240,200,114,0.9)]'
                        : 'border-amber-700/30 bg-black/25 hover:border-amber-500/50'
                    } ${!available ? 'opacity-50' : ''}`}
                  >
                    <span className="w-6 font-mono text-sm font-bold text-amber-300">{floor.floor}</span>
                    {available ? <Icon size={16} className="text-fuchsia-200" /> : <Lock size={15} className="text-amber-200/50" />}
                    <span className="flex-1 truncate font-display text-sm text-amber-50">{available ? floor.name : 'Запечатано'}</span>
                    {cleared && <Check size={15} className="text-emerald-300" aria-label="Пройден" />}
                  </motion.button>
                </li>
              );
            })}
          </ol>

          {boss && (
            <motion.div key={boss.floor} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-vial flex flex-col gap-3 p-4">
              <div className="flex items-center gap-3">
                <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full border border-fuchsia-400/50 bg-gradient-to-br from-fuchsia-950 to-[#120b1a] shadow-[0_0_24px_-6px_rgba(192,38,211,0.8)]">
                  {(() => {
                    const Icon = ENEMY_ICONS[boss.icon];
                    return <Icon size={30} className="text-fuchsia-200" />;
                  })()}
                </div>
                <div className="min-w-0">
                  <p className="font-mono text-xs text-amber-200/60">
                    Этаж {boss.floor} · ур. {boss.level} · HP {boss.hp}
                    {boss.shield > 0 ? ` · щит ${boss.shield}` : ''}
                  </p>
                  <p className="font-display text-lg leading-tight font-bold text-amber-50">{boss.name}</p>
                  <p className="text-sm text-amber-200/60 italic">{boss.title}</p>
                </div>
              </div>
              <p className="rounded-lg border border-fuchsia-500/30 bg-fuchsia-950/30 px-3 py-2 text-sm text-amber-50/90">
                <span className="font-display font-bold text-fuchsia-200">Условие: </span>
                {boss.rule}
              </p>
              {boss.traits.length > 0 && (
                <ul className="flex flex-wrap gap-1.5">
                  {boss.traits.map((t) => (
                    <li key={t} className="rounded-md border border-fuchsia-400/30 px-2 py-0.5 text-xs text-fuchsia-200" title={TRAIT_META[t].description}>
                      {TRAIT_META[t].name}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-sm text-amber-100/65 italic">«{boss.lore}»</p>
              <div className="flex flex-wrap gap-3 text-xs">
                {boss.weakness && (
                  <span className="inline-flex items-center gap-1 text-amber-100">
                    <ElementIcon element={boss.weakness} size={13} /> Уязвим: {ELEMENT_META[boss.weakness].name}
                  </span>
                )}
                {boss.resist && <span className="text-amber-200/60">Стоек: {ELEMENT_META[boss.resist].name}</span>}
                <span className="inline-flex items-center gap-1 text-amber-200">
                  <Coins size={12} /> {boss.floor > state.campaignCleared ? boss.firstClearGold : Math.round(boss.firstClearGold * 0.4)}
                </span>
              </div>
              <Button
                variant="arcane"
                icon={<Swords size={15} />}
                disabled={busy || boss.floor > state.campaignCleared + 1 || state.player.hp <= 0}
                onClick={() => {
                  actions.startFloor(boss.floor);
                  onStart();
                }}
              >
                {boss.floor > state.campaignCleared + 1 ? 'Сначала пройдите предыдущий этаж' : boss.floor <= state.campaignCleared ? 'Сразиться снова' : 'Бросить вызов'}
              </Button>
              {busy && <p className="text-xs text-amber-200/60">Сначала завершите текущий бой или блиц.</p>}
            </motion.div>
          )}
        </div>
        {state.campaignCleared >= 10 && (
          <p className="mt-4 flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 font-display text-amber-100">
            <Crown size={16} className="text-amber-300" /> Башня покорена. Вы — Числовой Алхимик!
          </p>
        )}
      </Panel>

      <Panel title="Математический Блиц" icon={<Zap size={15} />} delay={0.08}>
        <p className="text-sm text-amber-100/70">
          Режим выживания: 60 секунд, каждый верный ответ добавляет 3 секунды. Ошибка сбрасывает комбо. Награда — золото и эссенции за каждые 3 верных ответа школы.
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5" role="radiogroup" aria-label="Школа для блица">
          {(['chaos', ...ELEMENTS] as BlitzElement[]).map((choice) => {
            const locked = choice !== 'chaos' && !isElementUnlocked(state, choice);
            const selectedChoice = choice === blitzChoice;
            const Icon = choice === 'chaos' ? Zap : ELEMENT_ICONS[choice];
            return (
              <motion.button
                key={choice}
                type="button"
                role="radio"
                aria-checked={selectedChoice}
                disabled={locked}
                onClick={() => setBlitzChoice(choice)}
                whileTap={{ scale: 0.95 }}
                className={`focus-brass flex cursor-pointer flex-col items-center gap-1 rounded-xl border px-2 py-2 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  selectedChoice
                    ? choice === 'chaos'
                      ? 'border-amber-300/70 bg-amber-500/15 text-amber-100'
                      : `${ELEMENT_STYLE[choice].soft} ${ELEMENT_STYLE[choice].glow} text-amber-50`
                    : 'border-amber-700/30 bg-black/25 text-amber-200/70'
                }`}
              >
                {locked ? <Lock size={16} /> : <Icon size={18} className={choice === 'chaos' ? 'text-amber-300' : ELEMENT_STYLE[choice].text} />}
                <span className="font-display font-bold">{choice === 'chaos' ? 'Хаос' : ELEMENT_META[choice].name}</span>
              </motion.button>
            );
          })}
        </div>
        <Button
          className="mt-4 w-full"
          variant="brass"
          size="lg"
          icon={<Timer size={17} />}
          disabled={busy}
          onClick={() => {
            actions.startBlitz(blitzChoice);
            onStart();
          }}
        >
          Начать блиц
        </Button>

        <h3 className="mt-6 mb-2 flex items-center gap-2 font-display font-bold text-amber-200">
          <Trophy size={16} /> Личные рекорды
        </h3>
        {state.records.length === 0 ? (
          <p className="rounded-lg border border-dashed border-amber-700/40 px-3 py-4 text-center text-sm text-amber-200/60">Рекордов пока нет — сыграйте первый блиц.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[360px] text-left text-sm">
              <thead>
                <tr className="border-b border-amber-700/40 font-display text-xs text-amber-300/80">
                  <th className="py-1.5 pr-2">#</th>
                  <th className="py-1.5 pr-2">Школа</th>
                  <th className="py-1.5 pr-2 text-right">Очки</th>
                  <th className="py-1.5 pr-2 text-right">Верно</th>
                  <th className="py-1.5 pr-2 text-right">Комбо</th>
                  <th className="py-1.5 text-right">Дата</th>
                </tr>
              </thead>
              <tbody className="font-mono text-amber-50/85">
                {state.records.map((r, i) => (
                  <tr key={r.id} className={`border-b border-amber-900/40 ${i === 0 ? 'text-amber-200' : ''}`}>
                    <td className="py-1.5 pr-2">{i === 0 ? <Crown size={14} className="text-amber-300" /> : i + 1}</td>
                    <td className="py-1.5 pr-2 font-serif">{r.element === 'chaos' ? 'Хаос' : ELEMENT_META[r.element].name}</td>
                    <td className="py-1.5 pr-2 text-right font-bold">{r.score}</td>
                    <td className="py-1.5 pr-2 text-right">
                      {r.correct}/{r.correct + r.wrong}
                    </td>
                    <td className="py-1.5 pr-2 text-right">×{r.maxCombo}</td>
                    <td className="py-1.5 text-right text-xs text-amber-200/60">{dateFormatter.format(new Date(r.date))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
