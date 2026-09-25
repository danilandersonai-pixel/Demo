/**
 * «Как играть»: цель и очки, управление, препятствия с мини-иконками, сферы и
 * комбо, уровни скорости, перки кораблей. Все числа берутся из config.ts —
 * справка не разойдётся с балансом.
 */
import { motion, type Variants } from 'framer-motion';
import {
  CircleHelp,
  Gamepad2,
  Gauge,
  Hand,
  Keyboard,
  MousePointer2,
  Rocket,
  Sparkles,
  Target,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { bpmForLevel, GAME, multiplierForChain, OBSTACLES, SKIN_ORDER, SKINS, speedMultForLevel, THEMES } from '../game/config';
import type { ObstacleKind } from '../game/types';
import './menu/menu.css';
import { ObstacleIcon } from './menu/ObstacleIcon';
import { PerkChips } from './menu/PerkChips';
import { EASE_OUT, formatPercent } from './menu/shared';
import { useDialogFocus } from './menu/useDialogFocus';
import { ShipPreview } from './ShipPreview';
import { formatNumber, formatSpeed } from './ui/format';
import { Kbd } from './ui/Kbd';
import { Overlay } from './ui/Overlay';
import { Panel } from './ui/Panel';

export interface HowToPlayProps {
  onClose(): void;
}

const THEME = THEMES.cyberpunk;
const OBSTACLE_ORDER: readonly ObstacleKind[] = ['cube', 'saw', 'laser'];
/** Сколько уровней показать на «лестнице скорости». */
const LEVELS_SHOWN = 6;
const LEVELS = Array.from({ length: LEVELS_SHOWN }, (_, i) => i + 1);
const MAX_SPEED_SHOWN = speedMultForLevel(LEVELS_SHOWN);
const COMBO_STEPS = Array.from({ length: GAME.combo.maxMultiplier }, (_, i) => i + 1);

const grid: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.08 } },
};

const card: Variants = {
  hidden: { opacity: 0, y: 16, filter: 'blur(4px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.42, ease: EASE_OUT } },
};

type Tone = 'pink' | 'cyan' | 'yellow' | 'theme';

const TONE: Record<Tone, { icon: string; line: string }> = {
  pink: { icon: 'text-neon-pink border-neon-pink/50 bg-neon-pink/10', line: 'bg-neon-pink shadow-[0_0_8px_#ff2bd6]' },
  cyan: { icon: 'text-neon-cyan border-neon-cyan/50 bg-neon-cyan/10', line: 'bg-neon-cyan shadow-[0_0_8px_#22f0ff]' },
  yellow: { icon: 'text-neon-yellow border-neon-yellow/50 bg-neon-yellow/10', line: 'bg-neon-yellow shadow-[0_0_8px_#ffe94a]' },
  theme: { icon: 'text-theme-a border-theme-a/50 bg-theme-a/10', line: 'bg-theme-a shadow-[0_0_8px_var(--theme-a)]' },
};

function Card({
  icon: Icon,
  title,
  tone,
  className = '',
  children,
}: {
  icon: LucideIcon;
  title: string;
  tone: Tone;
  className?: string;
  children: ReactNode;
}) {
  const t = TONE[tone];
  return (
    <motion.section
      variants={card}
      className={['relative rounded-[4px] border border-white/10 bg-void/50 p-3.5 sm:p-4', className].join(' ')}
    >
      <span aria-hidden className={`absolute left-0 top-4 h-6 w-0.5 ${t.line}`} />
      <h3 className="mb-3 flex items-center gap-2.5">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[3px] border ${t.icon}`}>
          <Icon size={16} strokeWidth={2.3} aria-hidden />
        </span>
        <span className="text-xs font-bold uppercase tracking-[0.22em] text-ink sm:text-[13px]">{title}</span>
      </h3>
      {children}
    </motion.section>
  );
}

// ─── Разделы ────────────────────────────────────────────────────────────────

function Goal() {
  const s = GAME.score;
  const rows: { label: string; value: string; tone: string }[] = [
    { label: 'Выживание', value: `${s.perSecond} × уровень / с`, tone: 'text-ink' },
    { label: 'Уклонение', value: `+${s.dodge}`, tone: 'text-ink' },
    { label: 'Near miss — пролёт вплотную', value: `+${s.nearMiss}`, tone: 'text-[#c9a8ff]' },
    { label: 'Энергосфера', value: `+${s.crystal}`, tone: 'text-neon-cyan' },
    { label: 'Редкая золотая сфера', value: `+${s.rareCrystal}`, tone: 'text-neon-yellow' },
  ];
  return (
    <Card icon={Target} title="Цель" tone="pink">
      <p className="text-xs leading-relaxed text-ink-dim">
        Продержитесь как можно дольше: уворачивайтесь от препятствий, собирайте сферы и держите комбо. Каждую секунду капают очки,
        а скорость только растёт — бейте свой <span className="font-bold text-neon-yellow">BEST</span>.
      </p>
      <dl className="mt-3 flex flex-col divide-y divide-white/5 rounded-[3px] border border-white/5 bg-white/[0.02] text-[11px]">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3 px-2.5 py-1.5">
            <dt className="text-ink-dim">{r.label}</dt>
            <dd className={`nvm-digits whitespace-nowrap font-bold tracking-wider ${r.tone}`}>{r.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[10px] leading-snug text-ink-faint">Все очки умножаются на комбо и бонус корабля.</p>
    </Card>
  );
}

function ControlRow({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 rounded-[3px] border border-white/5 bg-white/[0.02] px-2.5 py-2">
      <Icon size={18} strokeWidth={2.1} className="mt-0.5 shrink-0 text-neon-cyan" aria-hidden />
      <div className="min-w-0">
        <span className="block text-[11px] font-bold uppercase tracking-widest text-ink">{title}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] leading-snug text-ink-dim">{children}</span>
      </div>
    </li>
  );
}

function Controls() {
  return (
    <Card icon={Gamepad2} title="Управление" tone="cyan">
      <ul className="flex flex-col gap-2">
        <ControlRow icon={Keyboard} title="Клавиатура">
          <Kbd>←</Kbd>
          <Kbd>→</Kbd>
          <span className="text-ink-faint">или</span>
          <Kbd>A</Kbd>
          <Kbd>D</Kbd>
          <span>— манёвр с инерцией</span>
        </ControlRow>
        <ControlRow icon={MousePointer2} title="Мышь">
          Просто ведите курсор — корабль плавно следует за ним, кликать не нужно
        </ControlRow>
        <ControlRow icon={Hand} title="Касание">
          Коснитесь экрана и ведите пальцем — корабль летит за ним
        </ControlRow>
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] tracking-wide text-ink-dim">
        <span className="flex items-center gap-1">
          <Kbd>Enter</Kbd> играть
        </span>
        <span className="flex items-center gap-1">
          <Kbd>Esc</Kbd>
          <span className="text-ink-faint">/</span>
          <Kbd>P</Kbd> пауза
        </span>
        <span className="flex items-center gap-1">
          <Kbd>R</Kbd> заново
        </span>
        <span className="flex items-center gap-1">
          <Kbd>M</Kbd> меню из паузы
        </span>
      </div>
    </Card>
  );
}

function Obstacles() {
  return (
    <Card icon={TriangleAlert} title="Препятствия" tone="pink">
      <ul className="flex flex-col gap-2">
        {OBSTACLE_ORDER.map((kind) => {
          const o = OBSTACLES[kind];
          return (
            <li key={kind} className="flex items-center gap-3 rounded-[3px] border border-white/5 bg-white/[0.02] px-2.5 py-2">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[3px] bg-void/80">
                <ObstacleIcon kind={kind} size={40} />
              </span>
              <div className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-ink">{o.title}</span>
                  {o.minLevel > 1 && (
                    <span className="rounded-[2px] border border-white/10 px-1 text-[9px] font-bold tracking-widest text-ink-faint">
                      LV {o.minLevel}+
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-ink-dim">{o.description}</span>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-2.5 text-[10px] leading-snug text-ink-faint">
        Хитбоксы чуть меньше нарисованных фигур — пролетать впритирку честно и выгодно.
      </p>
    </Card>
  );
}

function SpheresAndCombo() {
  const step = GAME.combo.step;
  return (
    <Card icon={Sparkles} title="Сферы и комбо" tone="cyan">
      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-center gap-2 rounded-[3px] border border-white/5 bg-white/[0.02] px-2 py-2">
          <ObstacleIcon kind="crystal" size={34} />
          <span className="min-w-0 text-[11px] leading-snug text-ink-dim">
            <span className="block font-bold uppercase tracking-wider text-neon-cyan">Сфера</span>+{GAME.score.crystal} очков,{' '}
            {GAME.crystal.currency} кристалл
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-[3px] border border-white/5 bg-white/[0.02] px-2 py-2">
          <ObstacleIcon kind="rare" size={34} />
          <span className="min-w-0 text-[11px] leading-snug text-ink-dim">
            <span className="block font-bold uppercase tracking-wider text-neon-yellow">Редкая</span>+{GAME.score.rareCrystal}{' '}
            очков, {GAME.crystal.rareCurrency} кристаллов
          </span>
        </div>
      </div>

      <div className="mt-3">
        <span className="mb-1.5 block text-[9px] font-bold uppercase tracking-[0.25em] text-ink-faint">COMBO MULTIPLIER</span>
        <ol className="flex gap-1" aria-label={`Множитель от x1 до x${GAME.combo.maxMultiplier}`}>
          {COMBO_STEPS.map((m) => {
            const k = (m - 1) / (GAME.combo.maxMultiplier - 1);
            return (
              <li
                key={m}
                className="nvm-digits flex h-7 min-w-0 flex-1 items-center justify-center rounded-[2px] border text-[10px] font-bold sm:text-[11px]"
                style={{
                  borderColor: `rgba(255,43,214,${0.25 + k * 0.7})`,
                  background: `rgba(255,43,214,${0.04 + k * 0.28})`,
                  color: k > 0.6 ? '#ffffff' : '#ff9ceb',
                  boxShadow: k > 0.5 ? `0 0 ${Math.round(k * 14)}px rgba(255,43,214,${k * 0.6})` : undefined,
                }}
              >
                x{m}
              </li>
            );
          })}
        </ol>
      </div>
      <p className="mt-2.5 text-[11px] leading-relaxed text-ink-dim">
        Каждые <b className="text-ink">{step} сферы подряд</b> — множитель +1: {step * 2} сфер дают x
        {multiplierForChain(step * 2)}, {step * (GAME.combo.maxMultiplier - 1)} — максимум x{GAME.combo.maxMultiplier}. Множитель{' '}
        <b className="text-neon-red">сбрасывается до x1</b> при столкновении (даже если спас щит) и когда сфера улетела мимо.
      </p>
    </Card>
  );
}

function SpeedLevels() {
  const colors = THEME.colors.grid;
  return (
    <Card icon={Gauge} title="Уровни скорости" tone="yellow" className="lg:col-span-2">
      <div className="grid gap-x-6 gap-y-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-end">
        <div>
          <p className="text-[11px] leading-relaxed text-ink-dim">
            Каждые <b className="text-neon-yellow">{GAME.levelDuration} секунд</b> — новый уровень: скорость падения +
            {formatPercent(GAME.speed.perLevel)}, ритм +{GAME.rhythm.bpmPerLevel} BPM, сетка меняет цвет. Со{' '}
            {GAME.zigzag.startLevel}-го уровня препятствия идут <b className="text-ink">зигзагом</b> и появляются лазерные стены.
          </p>
          <p className="mt-2 text-[10px] leading-snug text-ink-faint">
            {bpmForLevel(1)} BPM на старте · смена уровня встряхивает экран · зигзаг шире с каждым уровнем
          </p>
        </div>
        {/* Лестница скорости: высота столбца — множитель, цвет — цвет сетки уровня. */}
        <div className="flex h-28 items-end gap-1.5" role="img" aria-label="Рост скорости по уровням">
          {LEVELS.map((lv) => {
            const mult = speedMultForLevel(lv);
            const color = colors[(lv - 1) % colors.length];
            return (
              <div key={lv} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                <span className="nvm-digits text-[9px] font-bold tracking-wider" style={{ color }}>
                  {formatSpeed(mult)}
                </span>
                <motion.span
                  className="w-full rounded-t-[2px]"
                  style={{ background: `linear-gradient(180deg, ${color}, transparent)`, boxShadow: `0 0 12px ${color}66` }}
                  initial={{ height: 0 }}
                  // Столбцы от 18 до 70 % высоты: разница ×1.00 → ×1.70 должна читаться с первого взгляда.
                  animate={{ height: `${18 + ((mult - 1) / (MAX_SPEED_SHOWN - 1)) * 52}%` }}
                  transition={{ delay: 0.25 + lv * 0.06, duration: 0.5, ease: EASE_OUT }}
                />
                <span className="text-[9px] font-bold tracking-widest text-ink-faint">LV{lv}</span>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function ShipPerks() {
  return (
    <Card icon={Rocket} title="Перки кораблей" tone="theme" className="lg:col-span-2">
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {SKIN_ORDER.map((id) => {
          const skin = SKINS[id];
          return (
            <li key={id} className="flex items-center gap-3 rounded-[3px] border border-white/5 bg-white/[0.02] px-2.5 py-2">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[3px] bg-void/80">
                <ShipPreview skin={skin} theme={THEME} size={44} animated={false} />
              </span>
              <div className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-display text-[11px] font-bold tracking-wider text-ink">{skin.name}</span>
                  <span className="nvm-digits shrink-0 text-[10px] font-bold text-neon-cyan">
                    {skin.price === 0 ? 'FREE' : formatNumber(skin.price)}
                  </span>
                </span>
                <span className="block truncate text-[10px] uppercase tracking-widest text-ink-dim">{skin.title}</span>
                <PerkChips perks={skin.perks} className="mt-1.5" />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-2.5 text-[10px] leading-snug text-ink-faint">
        Щит-призрак прощает одно столкновение за забег: корабль мигает и {GAME.shield.invuln} с неуязвим. Магнит тянет сферы,
        «Усилитель поля» из магазина увеличивает его радиус.
      </p>
    </Card>
  );
}

// ─── Панель ─────────────────────────────────────────────────────────────────

/** Правила, управление, препятствия, комбо. Рендерит свой <Overlay layer={40}> + <Panel>. */
export function HowToPlay({ onClose }: HowToPlayProps) {
  const anchor = useRef<HTMLDivElement>(null);
  useDialogFocus(anchor);
  return (
    <Overlay layer={40} onBackdropClick={onClose} label="Как играть">
      <Panel
        title="Как играть"
        subtitle="Уворачивайтесь, собирайте сферы, держите комбо — и бейте рекорд"
        icon={CircleHelp}
        accent="pink"
        width="xl"
        onClose={onClose}
      >
        <motion.div ref={anchor} variants={grid} initial="hidden" animate="show" className="grid gap-3 sm:gap-4 lg:grid-cols-2">
          <Goal />
          <Controls />
          <Obstacles />
          <SpheresAndCombo />
          <SpeedLevels />
          <ShipPerks />
        </motion.div>
      </Panel>
    </Overlay>
  );
}
