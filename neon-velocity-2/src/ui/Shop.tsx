/**
 * Arcade Shop: корабли, темы оформления и улучшения за кристаллы. Вкладки и
 * кошелёк «прилипают» к верху прокручиваемого тела панели, покупка
 * сопровождается взрывом частиц из кнопки и «докруткой» кошелька.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { Palette, Rocket, Store, Zap } from 'lucide-react';
import { useRef, useState } from 'react';
import { SKIN_ORDER, SKINS, THEME_ORDER, THEMES, UPGRADE_ORDER, UPGRADES } from '../core/config';
import type { SaveData } from '../core/types';
import type { ProgressActions } from '../state/useProgress';
import { Overlay } from './kit/Overlay';
import { Panel } from './kit/Panel';
import { useDialogFocus } from './kit/useDialogFocus';
import './menu/menu.css';
import { usePurchaseBurst } from './menu/PurchaseBurst';
import { EASE_OUT, tabId, tabPanelId } from './menu/shared';
import { SkinCard, ThemeCard, UpgradeCard } from './menu/ShopCards';
import { TabBar, type TabDef } from './menu/TabBar';
import { Wallet } from './menu/Wallet';

export type ShopTab = 'skins' | 'themes' | 'upgrades';

export interface ShopProps {
  save: SaveData;
  actions: ProgressActions;
  onClose(): void;
  initialTab?: ShopTab;
}

const TAB_PREFIX = 'nv-shop';

// Полные строки классов — чтобы Tailwind увидел их при сборке.
const GRID: Record<ShopTab, string> = {
  skins: 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3',
  themes: 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 [@media(max-height:560px)]:lg:grid-cols-2',
  upgrades: 'grid grid-cols-1 gap-3 md:grid-cols-3',
};

/** Arcade Shop: корабли, темы, улучшения. Рендерит свой <Overlay layer={40}> + <Panel>. */
export function Shop({ save, actions, onClose, initialTab = 'skins' }: ShopProps) {
  const [tab, setTab] = useState<ShopTab>(initialTab);
  const anchor = useRef<HTMLDivElement>(null);
  const activeTab = useRef<HTMLButtonElement>(null);
  // Начальный фокус — на активной вкладке: стрелки сразу листают разделы, а
  // зажатый Enter, которым открыли магазин, ничего не нажимает повторно.
  useDialogFocus(anchor, activeTab);
  const burst = usePurchaseBurst();

  const theme = THEMES[save.equippedTheme];
  const skin = SKINS[save.equippedSkin];
  const upgradeTiers = UPGRADE_ORDER.reduce((n, id) => n + save.upgrades[id], 0);
  const upgradeMax = UPGRADE_ORDER.reduce((n, id) => n + UPGRADES[id].maxTier, 0);

  const tabs: TabDef<ShopTab>[] = [
    { id: 'skins', label: 'Корабли', icon: Rocket, badge: `${save.ownedSkins.length}/${SKIN_ORDER.length}` },
    { id: 'themes', label: 'Темы', icon: Palette, badge: `${save.ownedThemes.length}/${THEME_ORDER.length}` },
    { id: 'upgrades', label: 'Улучшения', icon: Zap, badge: `${upgradeTiers}/${upgradeMax}` },
  ];

  return (
    <Overlay layer={40} onBackdropClick={onClose} label="Магазин">
      <Panel
        title="Магазин"
        subtitle="Корабли, темы и улучшения — за кристаллы из забегов"
        icon={Store}
        accent="theme"
        width="xl"
        onClose={onClose}
      >
        {/* Минимальная высота держит панель на месте при смене вкладок (на низком экране она и так во всю высоту). */}
        <div ref={anchor} className="flex flex-col font-mono leading-normal sm:min-h-[27rem] [@media(max-height:700px)]:min-h-0">
          {/* Шапка магазина прилипает к верху тела панели. Фон непрозрачный (без
              backdrop-filter): карточки уходят под неё, а не просвечивают. */}
          <div className="sticky -top-4 z-10 -mx-4 -mt-4 flex flex-col-reverse gap-2 border-b border-white/8 bg-[#12102a] px-4 pb-3 pt-4 sm:-top-5 sm:-mx-6 sm:-mt-5 sm:flex-row sm:items-center sm:px-6 sm:pt-5 [@media(max-height:560px)]:pb-2 [@media(max-height:560px)]:pt-3 [@media(max-height:560px)_and_(min-width:520px)]:flex-row [@media(max-height:560px)_and_(min-width:520px)]:items-center">
            <TabBar<ShopTab>
              tabs={tabs}
              active={tab}
              onChange={setTab}
              idPrefix={TAB_PREFIX}
              label="Разделы магазина"
              activeRef={activeTab}
            />
            {/* В разметке кошелёк второй (после вкладок по Tab), а на телефоне стоит над ними — flex-col-reverse. */}
            <Wallet value={save.crystals} className="ml-auto" />
          </div>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              role="tabpanel"
              id={tabPanelId(TAB_PREFIX, tab)}
              aria-labelledby={tabId(TAB_PREFIX, tab)}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className={`pt-4 [@media(max-height:560px)]:pt-3 ${GRID[tab]}`}
            >
              {tab === 'skins' &&
                SKIN_ORDER.map((id) => (
                  <SkinCard
                    key={id}
                    skin={SKINS[id]}
                    theme={theme}
                    owned={save.ownedSkins.includes(id)}
                    equipped={save.equippedSkin === id}
                    crystals={save.crystals}
                    onBuy={() => actions.buySkin(id)}
                    onEquip={() => actions.equipSkin(id)}
                    burst={burst.fire}
                  />
                ))}
              {tab === 'themes' &&
                THEME_ORDER.map((id) => (
                  <ThemeCard
                    key={id}
                    theme={THEMES[id]}
                    owned={save.ownedThemes.includes(id)}
                    equipped={save.equippedTheme === id}
                    crystals={save.crystals}
                    onBuy={() => actions.buyTheme(id)}
                    onEquip={() => actions.equipTheme(id)}
                    burst={burst.fire}
                  />
                ))}
              {tab === 'upgrades' &&
                UPGRADE_ORDER.map((id) => (
                  <UpgradeCard
                    key={id}
                    upgrade={UPGRADES[id]}
                    tier={save.upgrades[id]}
                    crystals={save.crystals}
                    idleNote={id === 'fieldAmp' && !skin.perks.magnet ? 'Сработает на корабле с магнитом — сейчас надет другой.' : undefined}
                    onBuy={() => actions.buyUpgrade(id)}
                    burst={burst.fire}
                  />
                ))}
            </motion.div>
          </AnimatePresence>
        </div>
        {burst.layer}
      </Panel>
    </Overlay>
  );
}
