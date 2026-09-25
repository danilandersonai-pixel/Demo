// STUB: контракт таблицы лидеров. Владелец (агент menus) заменяет тело полностью, сохраняя экспортируемые сигнатуры.
import type { SaveData } from '../game/types';

export interface LeaderboardProps {
  save: SaveData;
  /** id записи последнего забега — подсветить строку. */
  highlightId?: string | null;
  onClose(): void;
}

/** Топ-5 забегов. Рендерит свой <Overlay layer={40}> + <Panel>. */
export function Leaderboard(_props: LeaderboardProps) {
  return null;
}
