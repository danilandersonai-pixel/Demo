/**
 * Главное меню поверх живого холста (attract-сцена): логотип, «Играть»,
 * панели, рекорд и кошелёк, текущее снаряжение, звук. Центр затемнён мягкой
 * радиальной подложкой, а не непрозрачной плашкой — сцена остаётся видна.
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
import { SKINS, THEMES } from '../game/config';
import type { MenuPanel, SaveData, Skin, Theme } from '../game/types';
import { AnimatedNumber } from './menu/AnimatedNumber';
import './menu/menu.css';
import { NeonLogo } from './menu/NeonLogo';
import { PlayButton } from './menu/PlayButton';
import { EASE_OUT, HIDE_KBD_ON_PHONE } from './menu/shared';
import { ShipPreview } from './ShipPreview';
import { IconButton } from './ui/IconButton';
import { Kbd } from './ui/Kbd';
import { NeonButton, type NeonVariant } from './ui/NeonButton';
import { padScore } from './ui/format';

export interface MainMenuProps {
  save: SaveData;
  /** Начать забег (App сам разблокирует звук). */
  onPlay(): void;
  onOpenPanel(panel: MenuPanel): void;
  onToggleSound(): void;
  /** false — localStorage недоступен: показать ненавязчивое предупреждение. */
  storageOk: boolean;
}

interface MenuItem {
  panel: MenuPanel;
  label: string;
  icon: LucideIcon;
  variant: NeonVariant;
}

const ITEMS: readonly MenuItem[] = [
  { panel: 'shop', label: 'Магазин', icon: Store, variant: 'cyan' },
  { panel: 'leaderboard', label: 'Рекорды', icon: Trophy, variant: 'yellow' },
  { panel: 'settings', label: 'Настройки', icon: Settings2, variant: 'ghost' },
  { panel: 'howto', label: 'Как играть', icon: CircleHelp, variant: 'ghost' },
];

// ─── Анимации ────────────────────────────────────────────────────────────────

const screenVariants: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.3, staggerChildren: 0.09 } },
  exit: { opacity: 0, scale: 1.03, filter: 'blur(6px)', transition: { duration: 0.28, ease: 'easeIn' } },
};

const fromTop: Variants = {
  hidden: { opacity: 0, y: -18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT } },
};

const fromBottom: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT, delay: 0.5 } },
};

const navList: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.55 } },
};

// Без filter: он остался бы на обёртке и отключил backdrop-blur кнопок внутри.
const navItem: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.96 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.45, ease: EASE_OUT } },
};

// ─── Плашки ─────────────────────────────────────────────────────────────────

function BestPlaque({ value }: { value: number }) {
  const { lead, digits } = padScore(value);
  return (
    <div className="flex items-center gap-2 rounded-[3px] border border-neon-yellow/35 bg-void/70 px-2.5 py-1.5 shadow-[0_0_14px_rgba(255,233,74,0.12)] backdrop-blur-sm sm:gap-2.5 sm:px-3">
      <Trophy size={17} strokeWidth={2.3} className="shrink-0 text-neon-yellow drop-shadow-[0_0_6px_#ffe94a]" aria-hidden />
      <div className="flex flex-col leading-none">
        <span className="text-[9px] font-bold tracking-[0.32em] text-neon-yellow/70">BEST</span>
        <span className="nvm-digits mt-1 font-mono text-[15px] font-extrabold tracking-wider sm:text-lg">
          <span className="sr-only">рекорд {value}</span>
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
    <div className="flex items-center gap-2 rounded-[3px] border border-neon-cyan/35 bg-void/70 px-2.5 py-1.5 shadow-[0_0_14px_rgba(34,240,255,0.12)] backdrop-blur-sm sm:gap-2.5 sm:px-3">
      <Gem size={17} strokeWidth={2.3} className="shrink-0 text-neon-cyan drop-shadow-[0_0_6px_#22f0ff]" aria-hidden />
      <div className="flex flex-col leading-none">
        <span className="text-[9px] font-bold tracking-[0.32em] text-neon-cyan/70">КРИСТАЛЛЫ</span>
        <span className="mt-1 font-mono text-[15px] font-extrabold tracking-wider text-neon-cyan text-glow-cyan sm:text-lg">
          <span className="sr-only">{value} кристаллов</span>
          <AnimatedNumber value={value} className="nvm-digits" />
        </span>
      </div>
    </div>
  );
}

function LoadoutCard({ skin, theme, onOpen }: { skin: Skin; theme: Theme; onOpen(): void }) {
  const swatches = [theme.colors.accent, theme.colors.accent2, theme.colors.accent3];
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.97 }}
      aria-label={`Снаряжение: корабль ${skin.name}, тема ${theme.name}. Открыть магазин`}
      className="group flex items-center gap-3 rounded-[3px] border border-white/10 bg-void/65 py-1.5 pl-1.5 pr-2.5 text-left backdrop-blur-sm transition-colors duration-150 hover:border-theme-a/60 hover:bg-void/80"
    >
      <span className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-[2px] border border-white/5 bg-void/80 [@media(max-height:560px)]:h-10 [@media(max-height:560px)]:w-10">
        <span
          aria-hidden
          className="absolute inset-0 opacity-60"
          style={{ background: `radial-gradient(circle at 50% 60%, ${theme.colors.skyBottom}, transparent 70%)` }}
        />
        <ShipPreview skin={skin} theme={theme} size={50} className="relative [@media(max-height:560px)]:scale-80" />
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="text-[9px] font-bold tracking-[0.3em] text-ink-faint">КОРАБЛЬ</span>
        <span className="mt-0.5 truncate font-display text-[13px] font-bold tracking-wider text-ink">{skin.name}</span>
        <span className="mt-1 flex items-center gap-1.5 text-[10px] tracking-wider text-ink-dim">
          <span className="flex gap-0.5" aria-hidden>
            {swatches.map((c) => (
              <span key={c} className="h-2 w-2 rounded-[1px]" style={{ background: c, boxShadow: `0 0 6px ${c}` }} />
            ))}
          </span>
          <span className="truncate">{theme.name}</span>
        </span>
      </span>
      <ChevronRight size={16} className="ml-1 shrink-0 text-ink-faint transition-colors group-hover:text-theme-a" aria-hidden />
    </motion.button>
  );
}

/**
 * Подсказка управления. На сенсорном экране (основной указатель — палец) клавиш
 * нет, и ширина тут не помогает: телефон боком шире sm. Вариант выбирает media
 * pointer: скрытый display:none уходит и из дерева доступности.
 */
function ControlsHint() {
  return (
    <p className="text-[10px] tracking-widest text-ink-dim">
      <span className="flex flex-wrap items-center justify-center gap-1.5 pointer-coarse:hidden">
        <span className="sr-only">Управление: стрелки влево и вправо или клавиши A и D, мышь, касание.</span>
        <span aria-hidden className="flex items-center gap-1.5">
          <Kbd>←</Kbd>
          <Kbd>→</Kbd>
          <span className="text-ink-faint">/</span>
          <Kbd>A</Kbd>
          <Kbd>D</Kbd>
          <span className="text-ink-faint">·</span>
          <span>мышь</span>
          <span className="text-ink-faint">·</span>
          <span>касание</span>
        </span>
      </span>
      <span className="hidden items-center justify-center gap-1.5 pointer-coarse:flex">
        <Hand size={13} className="shrink-0 text-neon-cyan" aria-hidden />
        ведите пальцем по экрану
      </span>
    </p>
  );
}

// ─── Меню ───────────────────────────────────────────────────────────────────

/** Главное меню поверх живого фона холста. App оборачивает в <AnimatePresence>. */
export function MainMenu({ save, onPlay, onOpenPanel, onToggleSound, storageOk }: MainMenuProps) {
  const skin = SKINS[save.equippedSkin];
  const theme = THEMES[save.equippedTheme];
  const soundOn = save.settings.sound;
  // Меню уже уходит (анимация выхода): кнопки не ловят клики. Второй слой к
  // проверкам App — уходящее меню не открывает панели поверх начатого забега.
  const isPresent = useIsPresent();

  return (
    <motion.div
      variants={screenVariants}
      initial="hidden"
      animate="show"
      exit="exit"
      className={`fixed inset-0 z-30 flex flex-col overflow-y-auto overflow-x-hidden ${isPresent ? '' : 'pointer-events-none'}`}
    >
      <div aria-hidden className="nvm-scrim pointer-events-none fixed inset-0" />

      {/* Низкий экран (телефон боком): поля сверху и снизу тоньше, превью корабля
          мельче — иначе на 640–740×360 снаряжение и подсказка уходят за нижний край. */}
      <motion.header
        variants={fromTop}
        className="nvm-safe-x relative flex items-start justify-between gap-3 pt-[max(1rem,env(safe-area-inset-top,0px))] [@media(max-height:560px)]:pt-[max(0.5rem,env(safe-area-inset-top,0px))]"
      >
        <div className="flex min-w-0 flex-wrap items-stretch gap-2 sm:gap-3">
          <BestPlaque value={save.highscore} />
          <WalletPlaque value={save.crystals} />
        </div>
        <IconButton
          icon={soundOn ? Volume2 : VolumeX}
          label={soundOn ? 'Выключить звук' : 'Включить звук'}
          aria-pressed={soundOn}
          variant={soundOn ? 'cyan' : 'ghost'}
          // Свой щелчок звучал бы по старой настройке; включение подтверждает AudioEngine.setSettings.
          sound={null}
          onClick={onToggleSound}
        />
      </motion.header>

      <div className="relative flex flex-1 flex-col items-center justify-center gap-7 px-4 py-6 sm:gap-10 [@media(max-height:560px)]:gap-3 [@media(max-height:560px)]:py-2">
        <NeonLogo />

        <motion.nav
          aria-label="Главное меню"
          variants={navList}
          className={`flex w-full max-w-md flex-col gap-2.5 [@media(max-height:560px)_and_(min-width:560px)]:max-w-2xl ${HIDE_KBD_ON_PHONE}`}
        >
          <motion.div
            variants={navItem}
            className="w-full self-center [@media(max-height:560px)_and_(min-width:560px)]:max-w-md"
          >
            <PlayButton onPlay={onPlay} />
          </motion.div>

          {/* Низкий экран — кнопки в один ряд, но только если хватает ширины: уже 560px
              четвертушка меньше самой длинной подписи («Как играть»), и остаётся сетка 2×2. */}
          <div className="grid grid-cols-2 gap-2.5 [@media(max-height:560px)_and_(min-width:560px)]:grid-cols-4">
            {ITEMS.map((item) => (
              <motion.div key={item.panel} variants={navItem}>
                <NeonButton
                  variant={item.variant}
                  icon={item.icon}
                  fullWidth
                  className="bg-void/70 px-3! backdrop-blur-sm"
                  onClick={() => onOpenPanel(item.panel)}
                >
                  {item.label}
                </NeonButton>
              </motion.div>
            ))}
          </div>

          {/* На телефоне снаряжение — под кнопками: низ экрана остаётся кораблю attract-сцены. */}
          <motion.div variants={navItem} className="mt-1 flex justify-center sm:hidden">
            <LoadoutCard skin={skin} theme={theme} onOpen={() => onOpenPanel('shop')} />
          </motion.div>
        </motion.nav>
      </div>

      <motion.footer
        variants={fromBottom}
        className="nvm-safe-x relative flex flex-col items-center gap-3 pb-[max(1rem,env(safe-area-inset-bottom,0px))] sm:flex-row sm:items-end sm:justify-between [@media(max-height:560px)]:pb-[max(0.5rem,env(safe-area-inset-bottom,0px))]"
      >
        <div className="hidden sm:block">
          <LoadoutCard skin={skin} theme={theme} onOpen={() => onOpenPanel('shop')} />
        </div>
        <div className="flex flex-col items-center gap-2 sm:items-end">
          {!storageOk && (
            <p
              role="status"
              className="flex max-w-xs items-center gap-1.5 rounded-[3px] border border-neon-red/50 bg-void/80 px-2.5 py-1.5 text-[10px] leading-snug tracking-wide text-neon-red"
            >
              <TriangleAlert size={14} strokeWidth={2.4} className="shrink-0" aria-hidden />
              Сохранение недоступно — прогресс пропадёт после перезагрузки страницы
            </p>
          )}
          <ControlsHint />
        </div>
      </motion.footer>
    </motion.div>
  );
}
