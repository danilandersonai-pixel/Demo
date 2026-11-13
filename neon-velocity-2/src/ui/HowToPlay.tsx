/**
 * Справка: управление, цель, три препятствия, сферы и комбо, OVERDRIVE, уровни
 * скорости, метки прилёта и перки кораблей. Все числа берутся из конфига —
 * текст не расходится с балансом. Клавиши показаны только там, где есть клавиатура.
 */
import { motion } from 'framer-motion';
import {
  CircleHelp,
  Flame,
  Gamepad2,
  Gauge,
  Gem,
  Hand,
  Keyboard,
  Magnet,
  MousePointer2,
  Music,
  Pause,
  Rocket,
  Shield,
  Sparkles,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { GAME, OBSTACLES, SKINS } from '../core/config';
import { BARS_PER_LEVEL, BPM, TICK_RATE, TICKS_PER_LEVEL } from '../core/timing';
import type { ObstacleKind } from '../core/types';
import { plural } from './kit/format';
import { Kbd } from './kit/Kbd';
import { NeonButton } from './kit/NeonButton';
import { Overlay } from './kit/Overlay';
import { Panel } from './kit/Panel';
import { useDialogFocus } from './kit/useDialogFocus';
import { GameIcon } from './menu/GameIcon';
import './menu/menu.css';
import { formatBonus, stagger, staggerItem } from './menu/shared';

export interface HowToPlayProps {
  onClose(): void;
}

const OBSTACLE_ORDER: ObstacleKind[] = ['cube', 'saw', 'laser'];

/** Клавиши не показываем на узком экране и при основном указателе-пальце. */
const KEYBOARD_ONLY = 'max-sm:hidden pointer-coarse:hidden';

const LEVEL_SECONDS = TICKS_PER_LEVEL / TICK_RATE;
const SHIELD_SECONDS = (GAME.shield.invulnTicks / TICK_RATE).toFixed(1).replace('.', ',');
const RARE_FACTOR = Math.round(GAME.score.rareCrystal / GAME.score.crystal);
const MULTIPLIERS = Array.from({ length: GAME.combo.maxMultiplier }, (_, i) => i + 1);

// Полные строки классов — чтобы Tailwind увидел их при сборке.
const ACCENT = {
  pink: 'text-neon-pink',
  cyan: 'text-neon-cyan',
  yellow: 'text-neon-yellow',
  green: 'text-neon-green',
  red: 'text-neon-red',
  violet: 'text-neon-violet',
} as const;

interface CardProps {
  icon: LucideIcon;
  title: string;
  accent: keyof typeof ACCENT;
  className?: string;
  children: ReactNode;
}

function Card({ icon: Icon, title, accent, className = '', children }: CardProps) {
  return (
    <motion.section variants={staggerItem} className={['flex min-w-0 flex-col gap-2.5 rounded-[3px] border border-white/10 bg-void/50 p-3 sm:p-4', className].join(' ')}>
      <h3 className={['m-0 flex items-center gap-2 text-xs font-bold uppercase tracking-widest sm:text-[13px]', ACCENT[accent]].join(' ')}>
        <Icon size={17} strokeWidth={2.3} className="shrink-0" aria-hidden />
        {title}
      </h3>
      {children}
    </motion.section>
  );
}

function Text({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={['m-0 text-xs leading-relaxed text-ink-dim', className].join(' ')}>{children}</p>;
}

/** Строка способа управления: значок, название, пояснение. */
function Control({ icon: Icon, title, className = '', children }: { icon: LucideIcon; title: string; className?: string; children: ReactNode }) {
  return (
    <li className={['flex items-start gap-2.5', className].join(' ')}>
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[3px] border border-neon-cyan/35 bg-neon-cyan/[0.06] text-neon-cyan">
        <Icon size={15} strokeWidth={2.2} aria-hidden />
      </span>
      <span className="min-w-0 text-xs leading-relaxed text-ink-dim">
        <b className="font-bold text-ink">{title}.</b> {children}
      </span>
    </li>
  );
}

function Perk({ icon: Icon, title, tone, children }: { icon: LucideIcon; title: string; tone: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className={['mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[3px] border bg-void/60', tone].join(' ')}>
        <Icon size={15} strokeWidth={2.2} aria-hidden />
      </span>
      <span className="min-w-0 text-xs leading-relaxed text-ink-dim">
        <b className="font-bold text-ink">{title}</b> — {children}
      </span>
    </li>
  );
}

function Points({ value }: { value: number }) {
  return <b className="nvm-digits font-bold text-neon-yellow">{value}</b>;
}

/** Правила, управление, препятствия, комбо. Рендерит свой <Overlay layer={40}> + <Panel>. */
export function HowToPlay({ onClose }: HowToPlayProps) {
  const anchor = useRef<HTMLDivElement>(null);
  // Фокус — на прокручиваемом содержимом: стрелки и PageDown сразу листают справку.
  useDialogFocus(anchor, anchor);
  const step = GAME.combo.step;

  return (
    <Overlay layer={40} onBackdropClick={onClose} label="Как играть">
      <Panel
        title="Как играть"
        subtitle="Летите в ритм, собирайте сферы, уходите от препятствий"
        icon={CircleHelp}
        accent="pink"
        width="xl"
        onClose={onClose}
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2 text-[11px] leading-snug tracking-wide text-ink-dim">
              <Music size={14} className="shrink-0 text-neon-pink" aria-hidden />
              <span>Всё прилетает в долю: {BPM}{'\u00a0'}BPM</span>
            </span>
            <NeonButton variant="pink" size="sm" sound="back" onClick={onClose}>
              Понятно
            </NeonButton>
          </div>
        }
      >
        <motion.div
          ref={anchor}
          tabIndex={-1}
          variants={stagger}
          initial="hidden"
          animate="show"
          className="nvm-focus-quiet grid grid-cols-1 gap-3 font-mono leading-normal md:grid-cols-2"
        >
          <Card icon={Gamepad2} title="Управление" accent="cyan">
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              <Control icon={Keyboard} title="Клавиатура" className={KEYBOARD_ONLY}>
                <span className="inline-flex items-center gap-1 align-middle">
                  <Kbd>←</Kbd>
                  <Kbd>→</Kbd>
                </span>{' '}
                или{' '}
                <span className="inline-flex items-center gap-1 align-middle">
                  <Kbd>A</Kbd>
                  <Kbd>D</Kbd>
                </span>{' '}
                — корабль плавно разгоняется и тормозит.
              </Control>
              <Control icon={MousePointer2} title="Мышь" className="pointer-coarse:hidden">
                Корабль сам летит за курсором, нажимать ничего не нужно.
              </Control>
              <Control icon={Hand} title="Касание">
                Коснитесь экрана и ведите пальцем — корабль идёт следом.
              </Control>
              <Control icon={Pause} title="Пауза">
                Кнопка в углу экрана
                <span className={KEYBOARD_ONLY}>
                  {' '}
                  или{' '}
                  <span className="inline-flex items-center gap-1 align-middle">
                    <Kbd>Esc</Kbd>
                    <Kbd>P</Kbd>
                  </span>
                </span>
                .
              </Control>
            </ul>
          </Card>

          <Card icon={Target} title="Цель" accent="yellow">
            <Text>
              Продержитесь как можно дольше и побейте рекорд. Корабль ходит только влево и вправо — дорога сама несётся навстречу.
            </Text>
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs leading-relaxed text-ink-dim">
              <li>
                Каждая прожитая доля — <Points value={GAME.score.perBeat} /> × уровень скорости.
              </li>
              <li>
                Сфера — <Points value={GAME.score.crystal} />, редкая — <Points value={GAME.score.rareCrystal} />.
              </li>
              <li>
                Уклонение — <Points value={GAME.score.dodge} />, а пролёт впритирку (NEAR MISS) — ещё <Points value={GAME.score.nearMiss} />.
              </li>
              <li>Всё это умножается на комбо.</li>
            </ul>
          </Card>

          <Card icon={Flame} title="Препятствия" accent="pink" className="md:col-span-2">
            <ul className="m-0 grid list-none grid-cols-1 gap-2.5 p-0 sm:grid-cols-3">
              {OBSTACLE_ORDER.map((kind) => (
                <li key={kind} className="flex items-start gap-3 rounded-[3px] border border-white/8 bg-void/50 p-2.5 sm:flex-col sm:items-center sm:text-center">
                  <GameIcon kind={kind} size={46} />
                  <span className="min-w-0">
                    <b className="block text-xs font-bold uppercase tracking-wider text-ink">{OBSTACLES[kind].title}</b>
                    <span className="mt-1 block text-[11px] leading-snug text-ink-dim">{OBSTACLES[kind].description}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex items-start gap-3 rounded-[3px] border border-neon-cyan/25 bg-neon-cyan/[0.04] p-2.5">
              <GameIcon kind="marker" size={46} />
              <span className="min-w-0">
                <b className="block text-xs font-bold uppercase tracking-wider text-neon-cyan">Метки прилёта</b>
                <span className="mt-1 block text-[11px] leading-snug text-ink-dim">
                  На линии корабля заранее загорается метка — там препятствие окажется в момент прилёта. У лазерных ворот подсвечен
                  проход. Смотрите на метку, а не на зигзаг.
                </span>
              </span>
            </div>
          </Card>

          <Card icon={Gem} title="Сферы и комбо" accent="cyan">
            <div className="flex items-start gap-3">
              <GameIcon kind="crystal" size={40} />
              <Text>
                Каждые {step} {plural(step, ['сферу', 'сферы', 'сфер'])} подряд поднимают множитель на один — до x{GAME.combo.maxMultiplier}.
                Пропустили сферу или врезались — комбо сгорает до x1.
              </Text>
            </div>
            <ol aria-label="Ступени множителя" className="m-0 flex list-none flex-wrap gap-1 p-0">
              {MULTIPLIERS.map((m) => (
                <li
                  key={m}
                  className={[
                    'nvm-digits flex h-6 min-w-7 items-center justify-center rounded-[2px] border px-1 text-[11px] font-extrabold',
                    m === GAME.combo.maxMultiplier
                      ? 'border-neon-yellow bg-neon-yellow/15 text-neon-yellow shadow-[0_0_10px_rgba(255,233,74,0.5)]'
                      : 'border-neon-cyan/40 text-neon-cyan',
                  ].join(' ')}
                  style={{ opacity: m === GAME.combo.maxMultiplier ? 1 : 0.45 + (0.55 * m) / GAME.combo.maxMultiplier }}
                >
                  x{m}
                </li>
              ))}
            </ol>
            <div className="flex items-start gap-3">
              <GameIcon kind="rare" size={40} />
              <Text>
                Редкая сфера — в {RARE_FACTOR} {plural(RARE_FACTOR, ['раз', 'раза', 'раз'])} больше очков и кристаллов. Сферы ещё и звучат:
                каждая играет ноту, а множитель добавляет слои музыки.
              </Text>
            </div>
          </Card>

          <div className="flex min-w-0 flex-col gap-3">
            <Card icon={Flame} title="OVERDRIVE" accent="yellow">
              <Text>
                На множителе x{GAME.combo.maxMultiplier} включается OVERDRIVE: все очки ×{GAME.combo.overdriveBonus}, пока комбо не сорвётся.
              </Text>
            </Card>
            <Card icon={Gauge} title="Уровни скорости" accent="green" className="flex-1">
              <Text>
                Каждые {LEVEL_SECONDS} {plural(LEVEL_SECONDS, ['секунду', 'секунды', 'секунд'])} ({BARS_PER_LEVEL}{' '}
                {plural(BARS_PER_LEVEL, ['такт', 'такта', 'тактов'])} музыки) — новый уровень: скорость {formatBonus(GAME.approach.perLevel)}, сетка
                дороги меняет цвет, экран встряхивает.
              </Text>
              <Text>
                Со {GAME.sway.startLevel}-го уровня препятствия идут зигзагом, с {OBSTACLES.laser.minLevel}-го появляются лазерные ворота —
                и чем дальше, тем у́же проход.
              </Text>
            </Card>
          </div>

          <Card icon={Rocket} title="Корабли и кристаллы" accent="violet" className="md:col-span-2">
            <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-3">
              <Perk icon={Sparkles} title="Шлейф" tone="border-neon-pink/45 text-neon-pink">
                светящийся хвост и {formatBonus(SKINS.trail.perks.scoreBonus)} к очкам.
              </Perk>
              <Perk icon={Shield} title="Щит-призрак" tone="border-neon-violet/55 text-[#c4b5fd]">
                прощает одно столкновение за забег, после удара {SHIELD_SECONDS} с неуязвимости.
              </Perk>
              <Perk icon={Magnet} title="Магнит" tone="border-neon-yellow/45 text-neon-yellow">
                притягивает сферы рядом с кораблём, комбо держать проще.
              </Perk>
            </ul>
            <Text>
              Сферы приносят кристаллы. В магазине на них покупают корабли, темы оформления и улучшения — резонатор, усилитель поля и призму удачи.
            </Text>
          </Card>
        </motion.div>
      </Panel>
    </Overlay>
  );
}
