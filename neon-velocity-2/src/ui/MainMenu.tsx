// STUB: контракт главного меню. Владелец (агент menus) заменяет тело целиком, сохраняя экспортируемые сигнатуры.
import type { MenuPanel, SaveData } from '../core/types';

export interface MainMenuProps {
  save: SaveData;
  /** Начать забег (App сам разблокирует звук). */
  onPlay(): void;
  onOpenPanel(panel: MenuPanel): void;
  onToggleSound(): void;
  /** false — localStorage недоступен: показать ненавязчивое предупреждение. */
  storageOk: boolean;
}

/** Главное меню поверх живой дороги. App оборачивает в <AnimatePresence>. */
export function MainMenu(_props: MainMenuProps) {
  return null;
}
