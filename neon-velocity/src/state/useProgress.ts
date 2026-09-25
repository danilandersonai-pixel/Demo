/**
 * React-хук прогресса: держит SaveData, автоматически сохраняет каждое
 * изменение в localStorage и отдаёт действия магазина и таблицы лидеров.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RunResult, SaveData, Settings, SkinId, ThemeId, UpgradeId } from '../game/types';
import * as P from './progress';
import { loadSave, persistSave } from './storage';

export interface ProgressActions {
  /** Купить скин (и сразу надеть). false — не хватает кристаллов или уже куплен. */
  buySkin(id: SkinId): boolean;
  equipSkin(id: SkinId): boolean;
  buyTheme(id: ThemeId): boolean;
  equipTheme(id: ThemeId): boolean;
  buyUpgrade(id: UpgradeId): boolean;
  /** Записать результат забега: валюта, рекорд, топ-5, статистика. */
  recordRun(result: RunResult): P.RecordOutcome;
  updateSettings(patch: Partial<Settings>): void;
  markTutorialSeen(): void;
  resetProgress(): void;
}

export interface UseProgress {
  save: SaveData;
  actions: ProgressActions;
  /** false — localStorage недоступен, прогресс живёт только до перезагрузки. */
  storageOk: boolean;
}

export function useProgress(): UseProgress {
  const [save, setSave] = useState<SaveData>(loadSave);
  const [storageOk, setStorageOk] = useState(true);
  // Актуальное сохранение для синхронных действий (recordRun возвращает результат сразу).
  const saveRef = useRef(save);

  useEffect(() => {
    setStorageOk(persistSave(save));
  }, [save]);

  const commit = useCallback((next: SaveData | null): boolean => {
    if (!next) return false;
    saveRef.current = next;
    setSave(next);
    return true;
  }, []);

  const actions = useMemo<ProgressActions>(
    () => ({
      buySkin: (id) => commit(P.buySkin(saveRef.current, id)),
      equipSkin: (id) => commit(P.equipSkin(saveRef.current, id)),
      buyTheme: (id) => commit(P.buyTheme(saveRef.current, id)),
      equipTheme: (id) => commit(P.equipTheme(saveRef.current, id)),
      buyUpgrade: (id) => commit(P.buyUpgrade(saveRef.current, id)),
      recordRun: (result) => {
        const outcome = P.recordRun(saveRef.current, result);
        commit(outcome.save);
        return outcome;
      },
      updateSettings: (patch) => {
        commit(P.updateSettings(saveRef.current, patch));
      },
      markTutorialSeen: () => {
        if (!saveRef.current.seenTutorial) commit({ ...saveRef.current, seenTutorial: true });
      },
      resetProgress: () => {
        commit(P.resetProgress(saveRef.current));
      },
    }),
    [commit],
  );

  return { save, actions, storageOk };
}
