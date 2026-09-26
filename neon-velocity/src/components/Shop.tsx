/**
 * Arcade Shop: корабли, темы и улучшения за кристаллы из забегов. Вкладки и
 * кошелёк закреплены сверху, сетка карточек прокручивается. Покупка сразу
 * надевает предмет — тема перекрашивает интерфейс и сцену за панелью.
 */
import { AnimatePresence, motion, type Variants } from 'framer-motion';
import { Gem, Palette, Rocket, Store, Wrench } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { GAME, SKIN_ORDER, SKINS, THEME_ORDER, THEMES, UPGRADE_ORDER, UPGRADES } from '../game/config';
import type { SaveData } from '../game/types';
import type { ProgressActions } from '../state/useProgress';
import './menu/menu.css';
import { usePurchaseBurst } from './menu/PurchaseBurst';
import { tabId, tabPanelId } from './menu/shared';
import { SkinCard, ThemeCard, UpgradeCard } from './menu/ShopCards';
import { TabBar, type TabDef } from './menu/TabBar';
import { useDialogFocus } from './menu/useDialogFocus';
import { WalletBadge } from './menu/WalletBadge';
import { Kbd } from './ui/Kbd';
import { Overlay } from './ui/Overlay';
import { Panel } from './ui/Panel';

export type ShopTab = 'skins' | 'themes' | 'upgrades';

export interface ShopProps {
  save: SaveData;
  actions: ProgressActions;
  onClose(): void;
  initialTab?: ShopTab;
}

const TAB_ORDER: readonly ShopTab[] = ['skins', 'themes', 'upgrades'];

/** Смена вкладки: содержимое уезжает в сторону, противоположную движению. */
const panelVariants: Variants = {
  enter: (dir: number) => ({ opacity: 0, x: 26 * dir }),
  center: { opacity: 1, x: 0, transition: { duration: 0.26, ease: [0.16, 1, 0.3, 1], staggerChildren: 0.045 } },
  exit: (dir: number) => ({ opacity: 0, x: -26 * dir, transition: { duration: 0.14, ease: 'easeIn' } }),
};

/** Arcade Shop: скины, темы, улучшения. Рендерит свой <Overlay layer={40}> + <Panel>. */
export function Shop({ save, actions, onClose, initialTab = 'skins' }: ShopProps) {
  const [tab, setTab] = useState<ShopTab>(initialTab);
  const [dir, setDir] = useState(1);
  const idPrefix = 'shop' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const anchor = useRef<HTMLDivElement>(null);
  const burst = usePurchaseBurst();
  useDialogFocus(anchor);

  const theme = THEMES[save.equippedTheme];
  const skin = SKINS[save.equippedSkin];
  const tierSum = UPGRADE_ORDER.reduce((n, id) => n + save.upgrades[id], 0);
  const tierMax = UPGRADE_ORDER.reduce((n, id) => n + UPGRADES[id].maxTier, 0);

  const tabs: readonly TabDef<ShopTab>[] = [
    { id: 'skins', label: 'Корабли', icon: Rocket, badge: `${save.ownedSkins.length}/${SKIN_ORDER.length}` },
    { id: 'themes', label: 'Темы', icon: Palette, badge: `${save.ownedThemes.length}/${THEME_ORDER.length}` },
    { id: 'upgrades', label: 'Улучшения', icon: Wrench, badge: `${tierSum}/${tierMax}` },
  ];

  const changeTab = (next: ShopTab) => {
    setDir(TAB_ORDER.indexOf(next) >= TAB_ORDER.indexOf(tab) ? 1 : -1);
    setTab(next);
  };

  const upgradeBurst = [theme.colors.accent, theme.colors.accent3, theme.colors.accent2, '#ffffff'];

  return (
    <Overlay layer={40} onBackdropClick={onClose} label="Магазин">
      <Panel
        title="Магазин"
        subtitle="Arcade Shop — корабли, темы и улучшения за кристаллы из забегов"
        icon={Store}
        accent="theme"
        width="xl"
        // Высота не зависит от вкладки — панель не «прыгает» при переключении.
        // Подвал здесь — справка, а не действия: на низком экране (телефон боком) его
        // строки нужнее карточкам, иначе от панели остаётся узкая щель прокрутки.
        className="h-full [@media(max-height:560px)]:[&>footer]:hidden"
        onClose={onClose}
        footer={
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[10px] tracking-wide text-ink-dim">
            <span className="flex items-center gap-1.5">
              <Gem size={12} className="shrink-0 text-neon-cyan" aria-hidden />
              Сфера — {GAME.crystal.currency} кристалл, редкая — {GAME.crystal.rareCurrency}. Покупка сразу надевает предмет.
            </span>
            {/* Подсказка клавиши — только там, где есть клавиатура: планшет и телефон боком шире sm. */}
            <span className="hidden items-center gap-1.5 sm:flex pointer-coarse:hidden">
              <Kbd>Esc</Kbd> закрыть
            </span>
          </div>
        }
      >
        {/* Шапка магазина закреплена: кошелёк и вкладки видны при прокрутке. Она — прямой
            потомок прокручиваемого тела панели (иначе sticky не выйдет за рамки обёртки), а
            отрицательный top компенсирует padding тела — липкая зона считается от него. */}
        <div
          ref={anchor}
          className="sticky -top-4 z-20 -mx-4 -mt-4 mb-4 flex flex-wrap items-center gap-2.5 border-b border-white/5 bg-[#0d0b1f]/95 px-4 pb-3 pt-4 sm:-top-5 sm:-mx-6 sm:-mt-5 sm:flex-nowrap sm:gap-4 sm:px-6 sm:pt-5 [@media(max-height:560px)]:mb-3 [@media(max-height:560px)]:pb-2 [@media(max-height:560px)]:pt-2"
        >
          <TabBar
            tabs={tabs}
            active={tab}
            onChange={changeTab}
            idPrefix={idPrefix}
            label="Разделы магазина"
            className="order-2 w-full sm:order-1 sm:w-auto sm:max-w-xl sm:flex-1"
          />
          <WalletBadge value={save.crystals} className="order-1 sm:order-2 sm:ml-auto" />
        </div>

        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={tab}
            role="tabpanel"
            id={tabPanelId(idPrefix, tab)}
            aria-labelledby={tabId(idPrefix, tab)}
            custom={dir}
            variants={panelVariants}
            initial="enter"
            animate="center"
            exit="exit"
            className={[
              'grid grid-cols-1 gap-3 sm:gap-4',
              tab === 'skins' ? 'sm:grid-cols-2 lg:grid-cols-3' : tab === 'themes' ? 'sm:grid-cols-2' : 'lg:grid-cols-3',
            ].join(' ')}
          >
            {tab === 'skins' &&
              SKIN_ORDER.map((id) => (
                <SkinCard
                  key={id}
                  skin={SKINS[id]}
                  theme={theme}
                  owned={save.ownedSkins.includes(id)}
                  equipped={save.equippedSkin === id}
                  wallet={save.crystals}
                  fire={burst.fire}
                  onBuy={() => actions.buySkin(id)}
                  onEquip={() => actions.equipSkin(id)}
                />
              ))}
            {tab === 'themes' &&
              THEME_ORDER.map((id) => (
                <ThemeCard
                  key={id}
                  theme={THEMES[id]}
                  owned={save.ownedThemes.includes(id)}
                  equipped={save.equippedTheme === id}
                  wallet={save.crystals}
                  fire={burst.fire}
                  onBuy={() => actions.buyTheme(id)}
                  onEquip={() => actions.equipTheme(id)}
                />
              ))}
            {tab === 'upgrades' &&
              UPGRADE_ORDER.map((id) => (
                <UpgradeCard
                  key={id}
                  id={id}
                  upgrades={save.upgrades}
                  wallet={save.crystals}
                  magnetless={!skin.perks.magnet}
                  burstColors={upgradeBurst}
                  fire={burst.fire}
                  onBuy={() => actions.buyUpgrade(id)}
                />
              ))}
          </motion.div>
        </AnimatePresence>
      </Panel>
      {burst.layer}
    </Overlay>
  );
}
