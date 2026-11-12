// STUB: контракт настроек. Владелец (агент menus) заменяет тело целиком, сохраняя экспортируемые сигнатуры.
import type { SaveData } from '../core/types';
import type { ProgressActions } from '../state/useProgress';

export interface SettingsPanelProps {
  save: SaveData;
  actions: ProgressActions;
  storageOk: boolean;
  onClose(): void;
}

/** Звук, громкость, тряска, FPS, сброс прогресса. Рендерит свой <Overlay layer={40}> + <Panel>. */
export function SettingsPanel(_props: SettingsPanelProps) {
  return null;
}
