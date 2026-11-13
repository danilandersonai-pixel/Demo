/**
 * Главное меню поверх живой трассы. Вторая редакция не складывает всё стопкой
 * в центре: логотип стоит в небе над солнцем, а управление разведено по краям
 * (широкий экран и телефон боком) или прижато к низу (портрет) — горизонт,
 * дорога и летящие препятствия остаются открытыми. Сплошной подложки нет,
 * только локальные затемнения под текстом; backdrop-filter не используется —
 * под меню каждый кадр перерисовывается холст.
 *
 * Раскладки (сетки и брейкпоинты) — в menu/menu.css.
 */
import { motion, useIsPresent, type Variants } from 'framer-motion';
import {
  ChevronRight,
  CircleHelp,
  Gem,
  Hand,
  Settings2,
  Store,
  TriangleAlert,
  Trophy,
  Volume2,
  VolumeX,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { audio } from '../audio/audio';
import { playUiSound } from '../audio/uiSound';
import { SKIN_ORDER, SKINS, THEME_ORDER, THEMES } from '../core/config';
import type { MenuPanel, SaveData, Skin, Theme } from '../core/types';
import { formatNumber, padScore, plural } from './kit/format';
import { IconButton } from './kit/IconButton';
import { Kbd } from './kit/Kbd';
import { AnimatedNumber } from './menu/AnimatedNumber';
import { Logo } from './menu/Logo';
import './menu/menu.css';
import { PerkChips } from './menu/PerkChips';
import { PlayButton } from './menu/PlayButton';
import { CRYSTAL_FORMS, EASE_OUT, releasePointerFocus } from './menu/shared';
import { ShipPreview } from './ShipPreview';
import { ThemePreview } from './ThemePreview';

export interface MainMenuProps {
  save: SaveData;
  /** Начать забег (App сам разблокирует звук). */
  onPlay(): void;
  onOpenPanel(panel: MenuPanel): void;
  onToggleSound(): void;
  /** false — localStorage недоступен: показать ненавязчивое предупреждение. */
  storageOk: boolean;
}

/**
 * Сколько только что появившееся меню не ловит указатель. Оно с первого кадра
 * лежит под пальцем: второй тап двойного нажатия «В меню» на экране Game Over
 * иначе открыл бы панель или начал забег. Клавиатуру задержка не трогает.
 */
const ARM_MS = 600;

type Tone = 'cyan' | 'yellow' | 'ghost';

// Полные строки классов — чтобы Tailwind увидел их при сборке.
const TILE_TONE: Record<Tone, string> = {
  cyan: 'border-neon-cyan/40 text-neon-cyan hover:border-neon-cyan hover:bg-neon-cyan/12 hover:shadow-[0_0_18px_rgba(34,240,255,0.28)]',
  yellow:
    'border-neon-yellow/40 text-neon-yellow hover:border-neon-yellow hover:bg-neon-yellow/12 hover:shadow-[0_0_18px_rgba(255,233,74,0.26)]',
  ghost: 'border-white/15 text-ink-dim hover:border-ink-dim hover:bg-white/8 hover:text-ink',
};

interface TileDef {
  panel: MenuPanel;
  label: string;
  icon: LucideIcon;
  tone: Tone;
  meta: string;
}

function tilesFor(save: SaveData): TileDef[] {
  const owned = save.ownedSkins.length + save.ownedThemes.length;
  const total = SKIN_ORDER.length + THEME_ORDER.length;
  const runs = save.leaderboard.length;
  return [
    { panel: 'shop', label: 'Магазин', icon: Store, tone: 'cyan', meta: `${owned} из ${total} открыто` },
    {
      panel: 'leaderboard',
      label: 'Рекорды',
      icon: Trophy,
      tone: 'yellow',
      meta: runs > 0 ? `${runs} ${plural(runs, ['забег', 'забега', 'забегов'])} в топе` : 'Таблица пуста',
    },
    { panel: 'settings', label: 'Настройки', icon: Settings2, tone: 'ghost', meta: save.settings.sound ? 'Звук включён' : 'Звук выключен' },
    { panel: 'howto', label: 'Как играть', icon: CircleHelp, tone: 'ghost', meta: 'Правила за минуту' },
  ];
}

// ─── Анимации ────────────────────────────────────────────────────────────────

const screenVariants: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.3, staggerChildren: 0.08 } },
  exit: { opacity: 0, scale: 1.04, transition: { duration: 0.26, ease: 'easeIn' } },
};

const fromTop: Variants = {
  hidden: { opacity: 0, y: -16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT } },
};

const logoIn: Variants = {
  hidden: { opacity: 0, y: -10, scale: 0.9 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.7, ease: EASE_OUT } },
};

const fromBottom: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT } },
};

// ─── Плашки рекорда и кошелька ──────────────────────────────────────────────

function BestPlaque({ value }: { value: number }) {
  const { lead, digits } = padScore(value);
  return (
    <div className="flex items-center gap-2 rounded-[3px] border border-neon-yellow/35 bg-void/75 py-1.5 pl-2 pr-2.5 shadow-[0_0_14px_rgba(255,233,74,0.12)] sm:gap-2.5 sm:pr-3">
      <Trophy size={17} strokeWidth={2.3} className="shrink-0 text-neon-yellow drop-shadow-[0_0_6px_#ffe94a] max-[359px]:hidden" aria-hidden />
      <div className="flex flex-col leading-none">
        <span className="text-[9px] font-bold tracking-[0.32em] text-neon-yellow/70">BEST</span>
        <span className="nvm-digits mt-1 font-mono text-[15px] font-extrabold tracking-wider sm:text-lg [@media(max-height:559.98px)]:text-[15px]">
          <span className="sr-only">{`Рекорд: ${formatNumber(value)}`}</span>
          <span aria-hidden className="text-neon-yellow/25">
            {lead}
          </span>
          <span aria-hidden className="text-neon-yellow text-glow-yellow">
            {digits}
          </span>
        </span>
      </div>
    </div>
  );
}

function WalletPlaque({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2 rounded-[3px] border border-neon-cyan/35 bg-void/75 py-1.5 pl-2 pr-2.5 shadow-[0_0_14px_rgba(34,240,255,0.12)] sm:gap-2.5 sm:pr-3">
      <Gem size={17} strokeWidth={2.3} className="shrink-0 text-neon-cyan drop-shadow-[0_0_6px_#22f0ff] max-[359px]:hidden" aria-hidden />
      <div className="flex flex-col leading-none">
        <span className="text-[9px] font-bold tracking-[0.32em] text-neon-cyan/70">КРИСТАЛЛЫ</span>
        <span className="mt-1 font-mono text-[15px] font-extrabold tracking-wider text-neon-cyan text-glow-cyan sm:text-lg [@media(max-height:559.98px)]:text-[15px]">
          <span className="sr-only">{`${formatNumber(value)} ${plural(value, CRYSTAL_FORMS)}`}</span>
          <AnimatedNumber value={value} className="nvm-digits" />
        </span>
      </div>
    </div>
  );
}

// ─── Снаряжение ─────────────────────────────────────────────────────────────

interface LoadoutProps {
  skin: Skin;
  theme: Theme;
  onOpen(): void;
}

function loadoutLabel(skin: Skin, theme: Theme): string {
  return `Ангар: корабль ${skin.name}, тема ${theme.name}. Открыть магазин`;
}

function Swatches({ theme }: { theme: Theme }) {
  const colors = [theme.colors.accent, theme.colors.accent2, theme.colors.accent3];
  return (
    <span className="flex shrink-0 gap-0.5" aria-hidden>
      {colors.map((c) => (
        <span key={c} className="h-2 w-2 rounded-[1px]" style={{ background: c, boxShadow: `0 0 6px ${c}` }} />
      ))}
    </span>
  );
}

/** Узкая плашка снаряжения: портрет и телефон боком. */
function LoadoutStrip({ skin, theme, onOpen }: LoadoutProps) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.98 }}
      onMouseEnter={() => playUiSound('hover')}
      onClick={(e) => {
        releasePointerFocus(e.currentTarget);
        playUiSound('click');
        onOpen();
      }}
      aria-label={loadoutLabel(skin, theme)}
      className="nvm-hangar-strip group flex w-full items-center gap-2.5 rounded-[3px] border border-white/12 bg-void/75 py-1 pl-1 pr-2 text-left transition-colors duration-150 hover:border-theme-a/70 hover:bg-void/90"
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[2px] border border-white/8"
        style={{ background: `radial-gradient(circle at 50% 60%, ${theme.colors.skyBottom}, ${theme.colors.bg} 75%)` }}
      >
        <ShipPreview skin={skin} theme={theme} size={34} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1 leading-none">
        <span className="whitespace-nowrap font-display text-[13px] font-bold tracking-wider text-ink">{skin.name}</span>
        <span className="flex items-center gap-1.5 whitespace-nowrap text-[10px] tracking-wider text-ink-dim">
          <Swatches theme={theme} />
          {theme.name}
        </span>
      </span>
      {/* Значки перков — только там, где они не теснят название: не на 320px и не на узком «боку». */}
      <PerkChips skin={skin} compact className="shrink-0 max-[359px]:hidden [@media(max-height:559.98px)_and_(max-width:699px)]:hidden" />
      <ChevronRight size={16} className="shrink-0 text-ink-faint transition-colors group-hover:text-theme-a" aria-hidden />
    </motion.button>
  );
}

/** Карточка «Ангар» на широком экране: корабль на подиуме, перки и сцена темы. */
function LoadoutCard({ skin, theme, onOpen }: LoadoutProps) {
  return (
    <motion.button
      type="button"
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.98 }}
      onMouseEnter={() => playUiSound('hover')}
      onClick={(e) => {
        releasePointerFocus(e.currentTarget);
        playUiSound('click');
        onOpen();
      }}
      aria-label={loadoutLabel(skin, theme)}
      className="nvm-hangar-card group relative w-full flex-col rounded-[3px] border border-white/12 bg-void/78 p-3 text-left transition-colors duration-150 hover:border-theme-a/70 hover:shadow-[0_0_22px_color-mix(in_srgb,var(--theme-a)_30%,transparent)]"
    >
      <span aria-hidden className="pointer-events-none absolute -left-px -top-px h-2.5 w-2.5 border-l-2 border-t-2 border-theme-a" />
      <span aria-hidden className="pointer-events-none absolute -bottom-px -right-px h-2.5 w-2.5 border-b-2 border-r-2 border-theme-a" />

      <span className="flex items-center justify-between">
        <span className="text-[10px] font-bold tracking-[0.32em] text-ink-dim">АНГАР</span>
        <span className="flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-widest text-ink-faint transition-colors group-hover:text-theme-a">
          Сменить
          <ChevronRight size={14} aria-hidden />
        </span>
      </span>

      {/* Подиум: свечение в цветах темы и «пол» из линий перспективы. */}
      <span
        className="relative mt-2 flex h-28 items-center justify-center overflow-hidden rounded-[2px] border border-white/8 [@media(max-height:680px)]:h-20"
        style={{ background: `radial-gradient(ellipse at 50% 70%, ${theme.colors.skyBottom}, ${theme.colors.bg} 72%)` }}
      >
        <span
          aria-hidden
          className="nv-grid-floor absolute inset-x-[-40%] bottom-[-70%] top-[62%] opacity-50"
          style={{ ['--grid-color' as string]: theme.colors.grid[0] }}
        />
        <ShipPreview skin={skin} theme={theme} size={92} className="relative [@media(max-height:680px)]:scale-75" />
      </span>

      <span className="mt-2.5 font-display text-base font-bold tracking-wider text-ink">{skin.name}</span>
      <span className="mt-0.5 text-[11px] tracking-wide text-ink-dim">{skin.title}</span>
      <PerkChips skin={skin} className="mt-2" />

      <span className="mt-3 flex items-center gap-2.5 border-t border-white/10 pt-2.5">
        <span className="block h-10 w-[4.5rem] shrink-0 overflow-hidden rounded-[2px] border border-white/10">
          <ThemePreview theme={theme} />
        </span>
        <span className="flex min-w-0 flex-col gap-1 leading-none">
          <span className="text-[9px] font-bold tracking-[0.3em] text-ink-faint">ТЕМА</span>
          <span className="font-display text-xs font-bold tracking-wider text-ink">{theme.name}</span>
        </span>
      </span>
    </motion.button>
  );
}

// ─── Низ экрана ─────────────────────────────────────────────────────────────

/**
 * Подсказка управления. Клавиши показываются только там, где есть клавиатура:
 * не на узком экране и не при основном указателе-пальце (телефон боком шире sm).
 * Скрытый вариант — display: none, он уходит и из дерева доступности.
 */
function ControlsHint() {
  return (
    <p className="m-0 text-[10px] leading-none tracking-widest text-ink-dim">
      <span className="flex items-center gap-1.5 max-sm:hidden pointer-coarse:hidden">
        <span className="sr-only">Управление: стрелки влево и вправо или клавиши A и D, либо мышь.</span>
        <span aria-hidden className="flex items-center gap-1.5">
          <Kbd>←</Kbd>
          <Kbd>→</Kbd>
          <span className="text-ink-faint">/</span>
          <Kbd>A</Kbd>
          <Kbd>D</Kbd>
          <span className="text-ink-faint">·</span>
          <span>или мышь</span>
        </span>
      </span>
      <span className="hidden items-center gap-1.5 max-sm:flex pointer-coarse:flex">
        <Hand size={13} className="shrink-0 text-theme-b" aria-hidden />
        Ведите пальцем по экрану
      </span>
    </p>
  );
}

function StorageWarning() {
  return (
    <p
      role="status"
      className="m-0 flex max-w-sm items-start gap-1.5 rounded-[3px] border border-neon-red/50 bg-void/85 px-2.5 py-1.5 text-[10px] leading-snug tracking-wide text-neon-red"
    >
      <TriangleAlert size={14} strokeWidth={2.4} className="mt-px shrink-0" aria-hidden />
      Сохранение недоступно — прогресс не переживёт перезагрузку
    </p>
  );
}

// ─── Меню ───────────────────────────────────────────────────────────────────

/** Главное меню поверх живой дороги. App оборачивает в <AnimatePresence>. */
export function MainMenu({ save, onPlay, onOpenPanel, onToggleSound, storageOk }: MainMenuProps) {
  const skin = SKINS[save.equippedSkin];
  const theme = THEMES[save.equippedTheme];
  const soundOn = save.settings.sound;
  // Уходящее меню (анимация выхода) инертно: двойной клик по «Играть» не начнёт
  // второй забег, а Tab и Enter не достанут кнопки, которых уже «нет».
  const isPresent = useIsPresent();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setArmed(true), ARM_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const openShop = () => onOpenPanel('shop');

  return (
    <motion.div
      variants={screenVariants}
      initial="hidden"
      animate="show"
      exit="exit"
      inert={!isPresent}
      className={[
        'nvm-menu fixed inset-0 z-30 overflow-y-auto overflow-x-hidden font-mono leading-normal',
        armed && isPresent ? '' : 'pointer-events-none',
      ].join(' ')}
    >
      <div aria-hidden className="nvm-menu-scrim pointer-events-none fixed inset-0" />

      <motion.header variants={fromTop} className="nvm-menu-top relative flex flex-col items-start gap-2">
        <div className="flex w-full items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-stretch gap-2 sm:gap-3">
            <BestPlaque value={save.highscore} />
            <WalletPlaque value={save.crystals} />
          </div>
          <IconButton
            icon={soundOn ? Volume2 : VolumeX}
            label={soundOn ? 'Выключить звук' : 'Включить звук'}
            aria-pressed={soundOn}
            variant={soundOn ? 'cyan' : 'ghost'}
            // Свой щелчок прозвучал бы по старой настройке; включение подтверждает AudioEngine.
            sound={null}
            onClick={(e) => {
              releasePointerFocus(e.currentTarget);
              // Подтверждение щелчком — только для включения и только в этой вкладке.
              if (!soundOn) audio.armToggleConfirm();
              onToggleSound();
            }}
          />
        </div>
        {!storageOk && <StorageWarning />}
      </motion.header>

      <motion.div variants={logoIn} className="nvm-menu-logo relative">
        <Logo />
      </motion.div>

      <motion.nav variants={fromBottom} aria-label="Главное меню" className="nvm-menu-nav relative">
        <PlayButton onPlay={onPlay} />
        <div className="nvm-tiles">
          {tilesFor(save).map(({ panel, label, icon: Icon, tone, meta }) => (
            <motion.button
              key={panel}
              type="button"
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 500, damping: 28 }}
              onMouseEnter={() => playUiSound('hover')}
              onClick={(e) => {
                releasePointerFocus(e.currentTarget);
                playUiSound('click');
                onOpenPanel(panel);
              }}
              className={[
                'nvm-tile group flex select-none items-center rounded-[3px] border bg-void/75 font-mono transition-colors duration-150',
                TILE_TONE[tone],
              ].join(' ')}
            >
              <span className="nvm-tile-icon flex shrink-0 items-center justify-center">
                <Icon size={18} strokeWidth={2.2} aria-hidden />
              </span>
              <span className="nvm-tile-text flex flex-col gap-1 leading-none">
                <span className="nvm-tile-label whitespace-nowrap font-bold uppercase">{label}</span>
                <span className="nvm-tile-meta whitespace-nowrap text-[10px] tracking-wide text-ink-dim">{meta}</span>
              </span>
              <ChevronRight size={16} className="nvm-tile-chevron shrink-0 opacity-50 transition-opacity group-hover:opacity-100" aria-hidden />
            </motion.button>
          ))}
        </div>
      </motion.nav>

      {/* В разметке ангар идёт после навигации: по Tab сначала «Играть». Место на экране задаёт сетка. */}
      <motion.div variants={fromBottom} className="nvm-menu-hangar relative">
        <LoadoutStrip skin={skin} theme={theme} onOpen={openShop} />
        <LoadoutCard skin={skin} theme={theme} onOpen={openShop} />
      </motion.div>

      <motion.footer variants={fromBottom} className="nvm-menu-foot relative">
        <ControlsHint />
      </motion.footer>
    </motion.div>
  );
}
