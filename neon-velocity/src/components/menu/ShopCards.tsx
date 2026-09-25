/**
 * Карточки магазина: корабль, тема, улучшение. Покупка — звук, взрыв частиц
 * из кнопки, вспышка и «подскок» карточки; неудача — звук ошибки и дрожь.
 * Кнопка действия одна на все состояния (Купить → Надето), поэтому фокус
 * клавиатуры не теряется после покупки.
 */
import { motion, useAnimate, useReducedMotionConfig } from 'framer-motion';
import {
  AudioWaveform,
  Check,
  Clover,
  Info,
  Lock,
  Magnet,
  Palette,
  Rocket,
  ShoppingCart,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';
import { crystalYield, magnetRadius, rareChance, shipColors, SKIN_ORDER, SKINS, UPGRADES } from '../../game/config';
import { rgba } from '../../game/math';
import type { Skin, Theme, UpgradeId, UpgradeLevels } from '../../game/types';
import { playUiSound } from '../../game/uiSound';
import { ShipPreview } from '../ShipPreview';
import { ThemePreview } from '../ThemePreview';
import { CrystalCount } from '../ui/CrystalCount';
import { formatNumber, plural } from '../ui/format';
import { PerkChips } from './PerkChips';
import type { PurchaseBurstApi } from './PurchaseBurst';
import { cardVariants, formatBonus, formatPercent } from './shared';
import { ShopButton } from './ShopButton';

// ─── Общая «реакция» карточки ───────────────────────────────────────────────

function useCardFx() {
  const reduce = useReducedMotionConfig();
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const [flashKey, setFlashKey] = useState(0);
  const missingRef = useRef<HTMLSpanElement>(null);

  return {
    scope,
    flashKey,
    missingRef,
    /** Успешная покупка/экипировка: вспышка и лёгкий «подскок». */
    success() {
      setFlashKey((k) => k + 1);
      if (!reduce && scope.current) animate(scope.current, { scale: [1, 1.035, 1] }, { duration: 0.45, ease: 'easeOut' });
    },
    /** Не хватает кристаллов: дрожь строки «не хватает». */
    fail() {
      const target = missingRef.current ?? scope.current;
      if (!reduce && target) animate(target, { x: [0, -6, 6, -4, 4, 0] }, { duration: 0.36 });
    },
  };
}

function CardFlash({ flashKey, color }: { flashKey: number; color: string }) {
  if (flashKey === 0) return null;
  return (
    <motion.span
      key={flashKey}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10 rounded-[4px]"
      style={{
        background: `radial-gradient(ellipse at 50% 80%, ${rgba(color, 0.5)}, ${rgba(color, 0.12)} 45%, transparent 75%)`,
        boxShadow: `inset 0 0 0 2px ${color}, 0 0 28px ${rgba(color, 0.6)}`,
      }}
      initial={{ opacity: 1 }}
      animate={{ opacity: 0 }}
      transition={{ duration: 0.9, ease: 'easeOut' }}
    />
  );
}

// ─── Карточка предмета (корабль или тема) ────────────────────────────────────

interface ItemCardProps {
  stage: ReactNode;
  /** Сцена-превью — вертикальная у кораблей, широкая у тем. */
  stageKind: 'ship' | 'theme';
  name: string;
  title: string;
  description: string;
  extra: ReactNode;
  price: number;
  owned: boolean;
  equipped: boolean;
  wallet: number;
  equipIcon: LucideIcon;
  /** Цвет вспышки карточки при покупке и экипировке. */
  accent: string;
  burstColors: readonly string[];
  fire: PurchaseBurstApi['fire'];
  onBuy(): boolean;
  onEquip(): boolean;
}

function ItemCard(props: ItemCardProps) {
  const { stage, stageKind, name, title, description, extra, price, owned, equipped, wallet, equipIcon, accent } = props;
  const fx = useCardFx();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const missing = Math.max(0, price - wallet);
  const locked = !owned && missing > 0;
  const missingId = useId();

  const act = () => {
    if (equipped) return;
    if (owned) {
      if (props.onEquip()) {
        playUiSound('equip');
        fx.success();
      }
      return;
    }
    if (!locked && props.onBuy()) {
      playUiSound('buy');
      props.fire(buttonRef.current, props.burstColors);
      fx.success();
      return;
    }
    playUiSound('error');
    fx.fail();
  };

  let button: ReactNode;
  if (equipped) {
    button = (
      <ShopButton ref={buttonRef} tone="done" icon={Check} inactive onClick={act}>
        Надето
      </ShopButton>
    );
  } else if (owned) {
    button = (
      <ShopButton ref={buttonRef} tone="cyan" icon={equipIcon} onClick={act}>
        Надеть
      </ShopButton>
    );
  } else {
    button = (
      <ShopButton
        ref={buttonRef}
        tone={locked ? 'locked' : 'pink'}
        icon={locked ? Lock : ShoppingCart}
        inactive={locked}
        aria-describedby={locked ? missingId : undefined}
        aria-label={`Купить ${name} за ${price} кристаллов`}
        onClick={act}
      >
        Купить
      </ShopButton>
    );
  }

  return (
    <motion.article variants={cardVariants} className="group relative">
      <div
        ref={fx.scope}
        className={[
          'relative flex h-full overflow-hidden rounded-[4px] border bg-void/55 transition-colors duration-200',
          stageKind === 'ship' ? 'flex-row sm:flex-col' : 'flex-col',
          equipped
            ? 'box-glow-theme border-transparent'
            : owned
              ? 'border-white/15 hover:border-white/30'
              : locked
                ? 'border-white/10'
                : 'border-neon-pink/35 hover:border-neon-pink/70',
        ].join(' ')}
      >
        <div
          className={[
            'relative shrink-0 overflow-hidden',
            stageKind === 'ship'
              ? 'w-[104px] border-r border-white/5 sm:h-36 sm:w-full sm:border-b sm:border-r-0'
              : 'aspect-[16/7] w-full border-b border-white/5 sm:aspect-[16/8]',
            locked ? 'opacity-60 saturate-[0.55]' : '',
          ].join(' ')}
        >
          {stage}
          {equipped && (
            <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-[2px] bg-theme-a px-1.5 py-0.5 text-[9px] font-black tracking-[0.2em] text-void shadow-[0_0_12px_var(--theme-a)]">
              <Check size={10} strokeWidth={3.5} aria-hidden />
              НАДЕТО
            </span>
          )}
          {!owned && (
            <span
              role="img"
              aria-label="Не куплено"
              className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-[2px] border border-white/15 bg-void/70 text-ink-dim"
            >
              <Lock size={12} strokeWidth={2.5} aria-hidden />
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col p-3 sm:p-3.5">
          <h3 className="min-w-0">
            <span className="block truncate font-display text-[13px] font-bold tracking-wider text-ink sm:text-sm">{name}</span>
            <span className="mt-0.5 block text-[11px] font-semibold uppercase tracking-widest text-theme-a">{title}</span>
          </h3>
          <p className="mt-1.5 text-[11px] leading-snug text-ink-dim">{description}</p>
          <div className="mt-2">{extra}</div>

          <div className="mt-auto flex items-end justify-between gap-2 pt-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              {owned ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-ink-faint">
                  <Check size={12} strokeWidth={2.6} aria-hidden />
                  {price === 0 ? 'Бесплатно' : 'Куплено'}
                </span>
              ) : (
                <>
                  <span className={locked ? 'opacity-60' : ''}>
                    <CrystalCount value={price} size="md" />
                  </span>
                  {locked && (
                    <span
                      ref={fx.missingRef}
                      id={missingId}
                      className="inline-block whitespace-nowrap text-[10px] font-semibold tracking-wide text-neon-red"
                    >
                      не хватает {formatNumber(missing)}
                    </span>
                  )}
                </>
              )}
            </div>
            {button}
          </div>
        </div>
      </div>
      <CardFlash flashKey={fx.flashKey} color={accent} />
    </motion.article>
  );
}

// ─── Корабль ────────────────────────────────────────────────────────────────

export interface SkinCardProps {
  skin: Skin;
  theme: Theme;
  owned: boolean;
  equipped: boolean;
  wallet: number;
  fire: PurchaseBurstApi['fire'];
  onBuy(): boolean;
  onEquip(): boolean;
}

export function SkinCard({ skin, theme, owned, equipped, wallet, fire, onBuy, onEquip }: SkinCardProps) {
  const { hull } = shipColors(skin, theme);
  const stage = (
    <div className="relative flex h-full w-full items-center justify-center">
      <span
        aria-hidden
        className="absolute inset-0"
        style={{
          background: `radial-gradient(ellipse at 50% 42%, ${rgba(theme.colors.skyBottom, 0.9)}, ${theme.colors.bg} 72%)`,
        }}
      />
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-1/2 overflow-hidden opacity-45">
        <span
          className="nv-grid-floor absolute -inset-x-1/2 top-0 h-[220%]"
          style={{ ['--grid-color' as string]: rgba(theme.colors.grid[0], 0.5) }}
        />
      </span>
      <ShipPreview skin={skin} theme={theme} size={92} className="relative sm:h-[104px] sm:w-[104px]" />
    </div>
  );
  return (
    <ItemCard
      stage={stage}
      stageKind="ship"
      name={skin.name}
      title={skin.title}
      description={skin.description}
      extra={<PerkChips perks={skin.perks} />}
      price={skin.price}
      owned={owned}
      equipped={equipped}
      wallet={wallet}
      equipIcon={Rocket}
      accent={hull}
      burstColors={[hull, theme.colors.accent, theme.colors.accent2, '#ffffff']}
      fire={fire}
      onBuy={onBuy}
      onEquip={onEquip}
    />
  );
}

// ─── Тема ───────────────────────────────────────────────────────────────────

export interface ThemeCardProps {
  theme: Theme;
  owned: boolean;
  equipped: boolean;
  wallet: number;
  fire: PurchaseBurstApi['fire'];
  onBuy(): boolean;
  onEquip(): boolean;
}

export function ThemeCard({ theme, owned, equipped, wallet, fire, onBuy, onEquip }: ThemeCardProps) {
  const c = theme.colors;
  const swatches = [
    c.accent,
    c.accent2,
    c.accent3,
    ...c.grid.filter((g) => g !== c.accent && g !== c.accent2 && g !== c.accent3),
  ].slice(0, 7);
  const extra = (
    <div className="flex items-center gap-2">
      <span className="text-[9px] font-bold uppercase tracking-[0.25em] text-ink-faint">Палитра</span>
      <span className="flex gap-1" aria-hidden>
        {swatches.map((s) => (
          <span key={s} className="h-3 w-3 rounded-[2px]" style={{ background: s, boxShadow: `0 0 7px ${rgba(s, 0.8)}` }} />
        ))}
      </span>
    </div>
  );
  return (
    <ItemCard
      stage={<ThemePreview theme={theme} />}
      stageKind="theme"
      name={theme.name}
      title={`${c.grid.length} ${plural(c.grid.length, ['цвет', 'цвета', 'цветов'])} сетки`}
      description={theme.tagline}
      extra={extra}
      price={theme.price}
      owned={owned}
      equipped={equipped}
      wallet={wallet}
      equipIcon={Palette}
      accent={c.accent}
      burstColors={[c.accent, c.accent2, c.accent3, '#ffffff']}
      fire={fire}
      onBuy={onBuy}
      onEquip={onEquip}
    />
  );
}

// ─── Улучшение ──────────────────────────────────────────────────────────────

const UPGRADE_ICON: Record<UpgradeId, LucideIcon> = {
  resonator: AudioWaveform,
  fieldAmp: Magnet,
  lucky: Clover,
};

/** Что даёт уровень tier — человеческими словами и из формул config.ts. */
function upgradeEffect(id: UpgradeId, tier: number, upgrades: UpgradeLevels): string {
  const levels = { ...upgrades, [id]: tier };
  switch (id) {
    case 'resonator':
      return tier === 0 ? 'без бонуса' : `${formatBonus(crystalYield(levels) - 1)} кристаллов`;
    case 'fieldAmp':
      return `радиус ${Math.round(magnetRadius(SKINS.magnet, levels))}`;
    case 'lucky':
      return `шанс ${formatPercent(rareChance(levels))}`;
  }
}

/** Корабли с магнитом — для подсказки к «Усилителю поля». */
const MAGNET_SKINS = SKIN_ORDER.filter((id) => SKINS[id].perks.magnet).map((id) => `«${SKINS[id].title}»`);

export interface UpgradeCardProps {
  id: UpgradeId;
  upgrades: UpgradeLevels;
  wallet: number;
  /** У надетого корабля нет магнита — «Усилитель поля» пока бесполезен. */
  magnetless: boolean;
  burstColors: readonly string[];
  fire: PurchaseBurstApi['fire'];
  onBuy(): boolean;
}

export function UpgradeCard({ id, upgrades, wallet, magnetless, burstColors, fire, onBuy }: UpgradeCardProps) {
  const up = UPGRADES[id];
  const Icon = UPGRADE_ICON[id];
  const tier = upgrades[id];
  const maxed = tier >= up.maxTier;
  const price = maxed ? 0 : up.prices[tier];
  const missing = Math.max(0, price - wallet);
  const locked = !maxed && missing > 0;
  const fx = useCardFx();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const missingId = useId();

  const buy = () => {
    if (maxed) return;
    if (!locked && onBuy()) {
      playUiSound('buy');
      fire(buttonRef.current, burstColors);
      fx.success();
      return;
    }
    playUiSound('error');
    fx.fail();
  };

  return (
    <motion.article variants={cardVariants} className="relative">
      <div
        ref={fx.scope}
        className={[
          'relative flex h-full flex-col gap-3 rounded-[4px] border bg-void/55 p-3.5 sm:p-4',
          maxed ? 'border-neon-yellow/45 shadow-[0_0_18px_rgba(255,233,74,0.12)]' : 'border-white/12',
        ].join(' ')}
      >
        <header className="flex items-start gap-3">
          <span
            className={[
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-[3px] border',
              maxed ? 'border-neon-yellow/60 bg-neon-yellow/10 text-neon-yellow' : 'border-theme-a/50 bg-theme-a/10 text-theme-a',
            ].join(' ')}
          >
            <Icon size={21} strokeWidth={2.2} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[13px] font-bold uppercase leading-tight tracking-wider text-ink">{up.title}</h3>
            <p className="mt-1 text-[11px] leading-snug text-ink-dim">{up.description}</p>
          </div>
        </header>

        {/* Уровни-сегменты. */}
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.2em]">
            <span className="text-ink-faint">Уровень</span>
            <span className={`nvm-digits ${maxed ? 'text-neon-yellow' : 'text-theme-a'}`}>
              {tier} / {up.maxTier}
            </span>
          </div>
          <div
            className="flex gap-1.5"
            role="meter"
            aria-label={`${up.title}: уровень ${tier} из ${up.maxTier}`}
            aria-valuemin={0}
            aria-valuemax={up.maxTier}
            aria-valuenow={tier}
          >
            {Array.from({ length: up.maxTier }, (_, i) => {
              const filled = i < tier;
              const next = i === tier && !maxed;
              return (
                <motion.span
                  key={`${i}-${filled ? 'on' : 'off'}`}
                  initial={filled && i === tier - 1 ? { scaleY: 0.2, opacity: 0.4 } : false}
                  animate={{ scaleY: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 18 }}
                  className={[
                    'h-2.5 flex-1 -skew-x-[20deg] rounded-[1px]',
                    filled
                      ? maxed
                        ? 'bg-neon-yellow shadow-[0_0_10px_#ffe94a]'
                        : 'bg-theme-a shadow-[0_0_10px_var(--theme-a)]'
                      : next
                        ? 'animate-pulse-glow border border-dashed border-theme-a/60 bg-theme-a/10'
                        : 'border border-white/10 bg-white/[0.03]',
                  ].join(' ')}
                />
              );
            })}
          </div>
        </div>

        {/* Эффект сейчас → после покупки. */}
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded-[3px] border border-white/5 bg-white/[0.02] px-2 py-1.5">
            <span className="block text-[9px] font-bold uppercase tracking-[0.2em] text-ink-faint">Сейчас</span>
            <span className="mt-0.5 block text-ink">{upgradeEffect(id, tier, upgrades)}</span>
          </div>
          <div
            className={[
              'rounded-[3px] border px-2 py-1.5',
              maxed ? 'border-neon-yellow/25 bg-neon-yellow/[0.04]' : 'border-theme-a/25 bg-theme-a/[0.05]',
            ].join(' ')}
          >
            <span className="block text-[9px] font-bold uppercase tracking-[0.2em] text-ink-faint">
              {maxed ? 'Предел' : 'Далее'}
            </span>
            <span className={`mt-0.5 block ${maxed ? 'text-neon-yellow' : 'text-theme-a'}`}>
              {maxed ? 'максимум' : upgradeEffect(id, tier + 1, upgrades)}
            </span>
          </div>
        </div>

        {id === 'fieldAmp' && magnetless && (
          <p className="flex items-start gap-1.5 rounded-[3px] border border-neon-yellow/25 bg-neon-yellow/[0.05] px-2 py-1.5 text-[10px] leading-snug text-neon-yellow/90">
            <Info size={13} strokeWidth={2.4} className="mt-px shrink-0" aria-hidden />
            <span>На надетом корабле нет магнита — усилитель заработает на {MAGNET_SKINS.join(' и ')}.</span>
          </p>
        )}

        <div className="mt-auto flex items-end justify-between gap-2 pt-1">
          <div className="flex min-w-0 flex-col gap-0.5">
            {maxed ? (
              <span className="inline-flex items-center gap-1.5 font-display text-sm font-black tracking-[0.25em] text-neon-yellow text-glow-yellow">
                <Sparkles size={14} strokeWidth={2.5} aria-hidden />
                MAX
              </span>
            ) : (
              <>
                <span className={locked ? 'opacity-60' : ''}>
                  <CrystalCount value={price} size="md" />
                </span>
                {locked && (
                  <span
                    ref={fx.missingRef}
                    id={missingId}
                    className="inline-block whitespace-nowrap text-[10px] font-semibold tracking-wide text-neon-red"
                  >
                    не хватает {formatNumber(missing)}
                  </span>
                )}
              </>
            )}
          </div>
          {maxed ? (
            <ShopButton
              ref={buttonRef}
              tone="done"
              icon={Check}
              inactive
              onClick={buy}
              className="border-neon-yellow/45! bg-neon-yellow/[0.06]! text-neon-yellow!"
            >
              Максимум
            </ShopButton>
          ) : (
            <ShopButton
              ref={buttonRef}
              tone={locked ? 'locked' : 'pink'}
              icon={locked ? Lock : ShoppingCart}
              inactive={locked}
              aria-describedby={locked ? missingId : undefined}
              aria-label={`Улучшить «${up.title}» до уровня ${tier + 1} за ${price} кристаллов`}
              onClick={buy}
            >
              Улучшить
            </ShopButton>
          )}
        </div>
      </div>
      <CardFlash flashKey={fx.flashKey} color={burstColors[0] ?? '#ffffff'} />
    </motion.article>
  );
}
