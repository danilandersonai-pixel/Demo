/**
 * React-хук прогресса: держит SaveData, автоматически сохраняет каждое
 * изменение в localStorage и отдаёт действия магазина и таблицы лидеров.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RunResult, SaveData, Settings, SkinId, ThemeId, UpgradeId } from '../game/types';
import * as P from './progress';
import { createDefaultSave, loadSave, persistSave, SAVE_KEY, sanitizeSave } from './storage';

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

/** Сохранение, записанное другой вкладкой; null — запись битая, оставляем своё. */
function readForeignSave(e: StorageEvent): SaveData | null {
  try {
    if (e.storageArea !== window.localStorage) return null;
    // key === null — другая вкладка очистила хранилище целиком.
    return e.newValue === null ? createDefaultSave() : sanitizeSave(JSON.parse(e.newValue));
  } catch {
    return null;
  }
}

export function useProgress(): UseProgress {
  const [save, setSave] = useState<SaveData>(loadSave);
  const [storageOk, setStorageOk] = useState(true);
  // Актуальное сохранение для синхронных действий (recordRun возвращает результат сразу).
  const saveRef = useRef(save);
  const storageOkRef = useRef(true);

  const persist = useCallback((next: SaveData) => {
    const ok = persistSave(next);
    // Состояние — только при смене: setState на каждый шаг слайдера громкости
    // копит вложенные обновления, и быстрый автоповтор клавиши упирается в лимит React.
    if (ok !== storageOkRef.current) {
      storageOkRef.current = ok;
      setStorageOk(ok);
    }
  }, []);

  // Проба хранилища при запуске; заодно записывает очищенную версию сохранения.
  useEffect(() => {
    persist(saveRef.current);
  }, [persist]);

  // Игра открыта в двух вкладках: берём то, что записала другая, иначе
  // следующее действие здесь затрёт её забеги, рекорды и покупки своей
  // устаревшей копией. Обратно не пишем — в хранилище уже ровно эти данные.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== SAVE_KEY) return;
      const next = readForeignSave(e);
      if (!next) return;
      saveRef.current = next;
      setSave(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const commit = useCallback(
    (next: SaveData | null): boolean => {
      if (!next) return false;
      saveRef.current = next;
      // Запись сразу, а не в эффекте после рендера: итог забега, сданный из
      // pagehide, должен попасть в хранилище до выгрузки страницы.
      persist(next);
      setSave(next);
      return true;
    },
    [persist],
  );

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
