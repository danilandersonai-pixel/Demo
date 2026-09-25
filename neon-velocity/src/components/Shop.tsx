// STUB: контракт магазина. Владелец (агент menus) заменяет тело полностью, сохраняя экспортируемые сигнатуры.
import type { SaveData } from '../game/types';
import type { ProgressActions } from '../state/useProgress';

export type ShopTab = 'skins' | 'themes' | 'upgrades';

export interface ShopProps {
  save: SaveData;
  actions: ProgressActions;
  onClose(): void;
  initialTab?: ShopTab;
}

/** Arcade Shop: скины, темы, улучшения. Рендерит свой <Overlay layer={40}> + <Panel>. */
export function Shop(_props: ShopProps) {
  return null;
}
