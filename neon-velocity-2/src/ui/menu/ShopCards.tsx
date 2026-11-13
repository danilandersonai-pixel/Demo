/**
 * Карточки магазина: корабль, тема, улучшение. Кнопка действия — всегда один и
 * тот же элемент во всех состояниях (купить → надето), поэтому фокус клавиатуры
 * не теряется в момент покупки.
 */
import { motion, useAnimate } from 'framer-motion';
import { ArrowRight, Check, ChevronsUp, Clover, DiamondPlus, Gem, Lock, Magnet, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useState, type MouseEvent, type ReactNode } from 'react';
import { playUiSound } from '../../audio/uiSound';
import { GAME, shipColors } from '../../core/config';
import type { Skin, Theme, Upgrade, UpgradeId } from '../../core/types';
import { formatNumber, plural } from '../kit/format';
import { ShipPreview } from '../ShipPreview';
import { ThemePreview } from '../ThemePreview';
import { ActionButton, type ActionTone } from './ActionButton';
import { PerkChips } from './PerkChips';
import { CRYSTAL_FORMS, formatBonus, formatPercent } from './shared';

/** Взрыв частиц из элемента в заданных цветах (см. usePurchaseBurst). */
export type BurstFn = (origin: Element | null, colors: readonly string[]) => void;

// ─── Общие части ────────────────────────────────────────────────────────────

/** Цена с иконкой кристалла внутри кнопки. */
function Price({ value }: { value: number }) {
  return (
    <span className="nvm-digits inline-flex items-center gap-1">
      <Gem size={13} strokeWidth={2.4} className="shrink-0" aria-hidden />
      {formatNumber(value)}
    </span>
  );
}

function crystalsText(n: number): string {
  return `${formatNumber(n)} ${plural(n, CRYSTAL_FORMS)}`;
}

interface CardFrameProps {
  /** Надетый предмет: рамка в цвете темы. */
  active: boolean;
  /** Номер покупки: при смене карточка вспыхивает. */
  flash: number;
  className?: string;
  children: ReactNode;
}

function CardFrame({ active, flash, className = '', children }: CardFrameProps) {
  return (
    <article
      className={[
        'relative flex min-w-0 flex-col gap-2.5 rounded-[3px] border p-3 transition-[border-color,box-shadow,background-color] duration-300',
        active
          ? 'border-theme-a/80 bg-theme-a/[0.06] shadow-[0_0_18px_color-mix(in_srgb,var(--theme-a)_28%,transparent),inset_0_0_18px_color-mix(in_srgb,var(--theme-a)_10%,transparent)]'
          : 'border-white/12 bg-void/55 hover:border-white/25',
        className,
      ].join(' ')}
    >
      {active && (
        <>
          <span aria-hidden className="pointer-events-none absolute -left-px -top-px h-2.5 w-2.5 border-l-2 border-t-2 border-theme-a" />
          <span aria-hidden className="pointer-events-none absolute -bottom-px -right-px h-2.5 w-2.5 border-b-2 border-r-2 border-theme-a" />
        </>
      )}
      {children}
      {flash > 0 && (
        <motion.span
          key={flash}
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[3px] bg-white"
          initial={{ opacity: 0.55 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.55, ease: 'easeOut' }}
        />
      )}
    </article>
  );
}

/** Состояние покупаемого предмета → вид и подпись кнопки действия. */
interface ActionView {
  tone: ActionTone;
  icon?: LucideIcon;
  label: ReactNode;
  spoken: string;
  unavailable?: boolean;
  passive?: boolean;
}

function itemAction(name: string, price: number, crystals: number, owned: boolean, equipped: boolean): ActionView {
  if (equipped) return { tone: 'done', icon: Check, label: 'Надето', spoken: `${name}: надето`, passive: true };
  if (owned) return { tone: 'equip', label: 'Надеть', spoken: `Надеть: ${name}` };
  if (crystals >= price) {
    return {
      tone: 'buy',
      label: (
        <>
          Купить <Price value={price} />
        </>
      ),
      spoken: `Купить: ${name} за ${crystalsText(price)}`,
    };
  }
  const lack = price - crystals;
  return {
    tone: 'locked',
    icon: Lock,
    label: (
      <>
        Не хватает <Price value={lack} />
      </>
    ),
    spoken: `${name}: не хватает ${crystalsText(lack)}, цена ${formatNumber(price)}`,
    unavailable: true,
  };
}

/** Покупка или экипировка по нажатию кнопки: звук, взрыв, вспышка карточки. */
function useItemAction(owned: boolean, colors: readonly string[], onBuy: () => boolean, onEquip: () => boolean, burst: BurstFn) {
  const [flash, setFlash] = useState(0);
  const [scope, animate] = useAnimate<HTMLDivElement>();

  const act = (e: MouseEvent<HTMLButtonElement>) => {
    const button = e.currentTarget;
    if (owned) {
      playUiSound(onEquip() ? 'equip' : 'error');
      return;
    }
    if (!onBuy()) {
      playUiSound('error');
      return;
    }
    playUiSound('buy');
    burst(button, colors);
    setFlash((n) => n + 1);
    void animate(scope.current, { scale: [1, 1.035, 1] }, { duration: 0.4, ease: 'easeOut' });
  };

  return { flash, scope, act };
}

// ─── Корабль ────────────────────────────────────────────────────────────────

export interface SkinCardProps {
  skin: Skin;
  /** Надетая тема: корабли без собственных цветов берут их из неё. */
  theme: Theme;
  owned: boolean;
  equipped: boolean;
  crystals: number;
  onBuy(): boolean;
  onEquip(): boolean;
  burst: BurstFn;
}

export function SkinCard({ skin, theme, owned, equipped, crystals, onBuy, onEquip, burst }: SkinCardProps) {
  const { hull, core } = shipColors(skin, theme);
  const { flash, scope, act } = useItemAction(owned, [hull, core, theme.colors.trail], onBuy, onEquip, burst);
  const action = itemAction(skin.title, skin.price, crystals, owned, equipped);
  return (
    <div ref={scope} className="flex min-w-0">
      <CardFrame active={equipped} flash={flash} className="w-full">
        <div className="flex gap-3">
          <div
            className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[2px] border border-white/8"
            style={{ background: `radial-gradient(circle at 50% 62%, ${theme.colors.skyBottom}, ${theme.colors.bg} 74%)` }}
          >
            <span
              aria-hidden
              className="nv-grid-floor absolute inset-x-[-60%] bottom-[-80%] top-[66%] opacity-45"
              style={{ ['--grid-color' as string]: theme.colors.grid[0] }}
            />
            <ShipPreview skin={skin} theme={theme} size={66} className="relative" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="m-0 font-display text-sm font-bold leading-tight tracking-wider text-ink">{skin.name}</h3>
            <p className="m-0 mt-0.5 text-[11px] font-semibold leading-tight tracking-wide text-theme-b">{skin.title}</p>
            <p className="m-0 mt-1.5 text-[11px] leading-snug text-ink-dim">{skin.description}</p>
          </div>
        </div>
        <PerkChips skin={skin} />
        <ActionButton
          tone={action.tone}
          icon={action.icon}
          unavailable={action.unavailable}
          passive={action.passive}
          sound={null}
          aria-label={action.spoken}
          onClick={act}
          className="mt-auto w-full"
        >
          {action.label}
        </ActionButton>
      </CardFrame>
    </div>
  );
}

// ─── Тема ───────────────────────────────────────────────────────────────────

export interface ThemeCardProps {
  theme: Theme;
  owned: boolean;
  equipped: boolean;
  crystals: number;
  onBuy(): boolean;
  onEquip(): boolean;
  burst: BurstFn;
}

export function ThemeCard({ theme, owned, equipped, crystals, onBuy, onEquip, burst }: ThemeCardProps) {
  const c = theme.colors;
  const { flash, scope, act } = useItemAction(owned, [c.accent, c.accent2, c.accent3], onBuy, onEquip, burst);
  const action = itemAction(theme.name, theme.price, crystals, owned, equipped);
  // Сцена оживает под курсором и с фокусом на кнопке; у надетой темы она живая всегда.
  const [hot, setHot] = useState(false);
  return (
    <div
      ref={scope}
      className="flex min-w-0"
      onPointerEnter={() => setHot(true)}
      onPointerLeave={() => setHot(false)}
      onFocus={() => setHot(true)}
      onBlur={() => setHot(false)}
    >
      <CardFrame active={equipped} flash={flash} className="w-full [@media(max-height:560px)]:flex-row [@media(max-height:560px)]:gap-3">
        <div className="aspect-[16/8] w-full shrink-0 overflow-hidden rounded-[2px] border border-white/10 [@media(max-height:560px)]:aspect-auto [@media(max-height:560px)]:w-2/5 [@media(max-height:560px)]:self-stretch">
          <ThemePreview theme={theme} live={equipped || hot} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div>
            <h3 className="m-0 font-display text-sm font-bold leading-tight tracking-wider text-ink">{theme.name}</h3>
            <p className="m-0 mt-1 text-[11px] leading-snug text-ink-dim">{theme.tagline}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex gap-1" aria-hidden>
              {c.grid.map((color, i) => (
                <span key={`${color}-${i}`} className="h-2.5 w-2.5 rounded-[1px]" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
              ))}
            </span>
            <span className="text-[10px] leading-tight tracking-wide text-ink-faint">
              {c.grid.length} {plural(c.grid.length, ['цвет', 'цвета', 'цветов'])} сетки
            </span>
          </div>
          <ActionButton
            tone={action.tone}
            icon={action.icon}
            unavailable={action.unavailable}
            passive={action.passive}
            sound={null}
            aria-label={action.spoken}
            onClick={act}
            className="mt-auto w-full"
          >
            {action.label}
          </ActionButton>
        </div>
      </CardFrame>
    </div>
  );
}

// ─── Улучшение ──────────────────────────────────────────────────────────────

const UPGRADE_ICON: Record<UpgradeId, LucideIcon> = {
  resonator: DiamondPlus,
  fieldAmp: Magnet,
  lucky: Clover,
};

/** Суммарный эффект улучшения на уровне tier — коротко, с единицей измерения. */
function upgradeEffect(upgrade: Upgrade, tier: number): string {
  switch (upgrade.id) {
    case 'resonator':
      return `${formatBonus(upgrade.perTier * tier)} кристаллов`;
    case 'fieldAmp':
      return `${formatBonus(upgrade.perTier * tier)} радиуса`;
    case 'lucky':
      return `${formatPercent(GAME.crystal.rareChance + upgrade.perTier * tier)} редких сфер`;
  }
}

export interface UpgradeCardProps {
  upgrade: Upgrade;
  tier: number;
  crystals: number;
  /** Улучшение ничего не даёт текущему кораблю (усилитель поля без магнита). */
  idleNote?: string;
  onBuy(): boolean;
  burst: BurstFn;
}

export function UpgradeCard({ upgrade, tier, crystals, idleNote, onBuy, burst }: UpgradeCardProps) {
  const Icon = UPGRADE_ICON[upgrade.id];
  const maxed = tier >= upgrade.maxTier;
  const price = maxed ? 0 : upgrade.prices[tier];
  const lack = price - crystals;
  const { flash, scope, act } = useItemAction(false, ['#ffe94a', '#22f0ff', '#ffffff'], onBuy, () => false, burst);

  let action: ActionView;
  if (maxed) {
    action = { tone: 'done', icon: Check, label: 'Максимум', spoken: `${upgrade.title}: максимальный уровень`, passive: true };
  } else if (lack <= 0) {
    action = {
      tone: 'buy',
      icon: ChevronsUp,
      label: (
        <>
          Улучшить <Price value={price} />
        </>
      ),
      spoken: `Улучшить: ${upgrade.title}, уровень ${tier + 1} за ${crystalsText(price)}`,
    };
  } else {
    action = {
      tone: 'locked',
      icon: Lock,
      label: (
        <>
          Не хватает <Price value={lack} />
        </>
      ),
      spoken: `${upgrade.title}: не хватает ${crystalsText(lack)}, цена ${formatNumber(price)}`,
      unavailable: true,
    };
  }

  return (
    <div ref={scope} className="flex min-w-0">
      <CardFrame active={false} flash={flash} className="w-full">
        <div className="flex gap-3">
          <span
            className={[
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-[3px] border',
              tier > 0 ? 'border-neon-yellow/60 bg-neon-yellow/10 text-neon-yellow' : 'border-white/12 bg-white/[0.03] text-ink-dim',
            ].join(' ')}
          >
            <Icon size={22} strokeWidth={2.1} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="m-0 text-xs font-bold uppercase leading-tight tracking-wider text-ink sm:text-[13px]">{upgrade.title}</h3>
            <p className="m-0 mt-1 text-[11px] leading-snug text-ink-dim">{upgrade.description}</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <span role="img" aria-label={`Уровень ${tier} из ${upgrade.maxTier}`} className="flex flex-1 gap-1">
            {Array.from({ length: upgrade.maxTier }, (_, i) => (
              <span
                key={i}
                className={[
                  'h-2 flex-1 -skew-x-12 rounded-[1px] border transition-colors duration-300',
                  i < tier
                    ? 'border-neon-yellow bg-neon-yellow shadow-[0_0_8px_rgba(255,233,74,0.7)]'
                    : i === tier
                      ? 'animate-pulse-glow border-neon-yellow/60 bg-neon-yellow/10'
                      : 'border-white/15 bg-white/[0.03]',
                ].join(' ')}
              />
            ))}
          </span>
          <span className="nvm-digits shrink-0 text-[10px] font-bold uppercase tracking-widest text-ink-dim" aria-hidden>
            Ур. {tier}/{upgrade.maxTier}
          </span>
        </div>

        <p className="m-0 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] font-semibold leading-tight">
          <span className="sr-only">Сейчас:</span>
          <span className={tier > 0 ? 'text-neon-yellow' : 'text-ink-dim'}>{upgradeEffect(upgrade, tier)}</span>
          {!maxed && (
            <>
              <ArrowRight size={12} className="shrink-0 text-ink-faint" aria-hidden />
              <span className="sr-only">после улучшения:</span>
              <span className="text-neon-green">{upgradeEffect(upgrade, tier + 1)}</span>
            </>
          )}
        </p>

        {idleNote && (
          <p className="m-0 flex items-start gap-1.5 text-[10px] leading-snug text-neon-yellow/80">
            <TriangleAlert size={12} className="mt-px shrink-0" aria-hidden />
            {idleNote}
          </p>
        )}

        <ActionButton
          tone={action.tone}
          icon={action.icon}
          unavailable={action.unavailable}
          passive={action.passive}
          sound={null}
          aria-label={action.spoken}
          onClick={act}
          className="mt-auto w-full"
        >
          {action.label}
        </ActionButton>
      </CardFrame>
    </div>
  );
}
