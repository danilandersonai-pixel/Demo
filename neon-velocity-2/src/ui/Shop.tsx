// STUB: контракт магазина. Владелец (агент menus) заменяет тело целиком, сохраняя экспортируемые сигнатуры.
import type { SaveData } from '../core/types';
import type { ProgressActions } from '../state/useProgress';

export type ShopTab = 'skins' | 'themes' | 'upgrades';

export interface ShopProps {
  save: SaveData;
  actions: ProgressActions;
  onClose(): void;
  initialTab?: ShopTab;
}

/** Arcade Shop: корабли, темы, улучшения. Рендерит свой <Overlay layer={40}> + <Panel>. */
export function Shop(_props: ShopProps) {
  return null;
}
