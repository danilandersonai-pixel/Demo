// STUB: контракт главного меню. Владелец (агент menus) заменяет тело полностью, сохраняя экспортируемые сигнатуры.
import type { MenuPanel, SaveData } from '../game/types';

export interface MainMenuProps {
  save: SaveData;
  /** Начать забег (App сам разблокирует звук). */
  onPlay(): void;
  onOpenPanel(panel: MenuPanel): void;
  onToggleSound(): void;
  /** false — localStorage недоступен: показать ненавязчивое предупреждение. */
  storageOk: boolean;
}

/** Главное меню поверх живого фона холста. App оборачивает в <AnimatePresence>. */
export function MainMenu(_props: MainMenuProps) {
  return null;
}
