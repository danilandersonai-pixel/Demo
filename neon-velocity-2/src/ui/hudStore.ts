/**
 * Мост между игровым циклом и React. Цикл пишет сюда снимок HUD (не чаще
 * ~30 раз в секунду), баннеры и цифру отсчёта после паузы, а компоненты
 * подписываются через хуки на useSyncExternalStore — никакого setState в каждом кадре.
 */
import { useSyncExternalStore } from 'react';
import type { Banner, BannerKind, HudSnapshot } from '../core/types';

type Listener = () => void;

export const EMPTY_HUD: HudSnapshot = {
  score: 0,
  highscore: 0,
  multiplier: 1,
  chain: 0,
  chainProgress: 0,
  overdrive: false,
  level: 1,
  speedMult: 1,
  levelProgress: 0,
  crystals: 0,
  shield: 0,
  shieldMax: 0,
  newRecord: false,
  elapsed: 0,
  fps: 0,
};

function sameHud(a: HudSnapshot, b: HudSnapshot): boolean {
  return (
    a.score === b.score &&
    a.highscore === b.highscore &&
    a.multiplier === b.multiplier &&
    a.chain === b.chain &&
    a.chainProgress === b.chainProgress &&
    a.overdrive === b.overdrive &&
    a.level === b.level &&
    a.speedMult === b.speedMult &&
    a.levelProgress === b.levelProgress &&
    a.crystals === b.crystals &&
    a.shield === b.shield &&
    a.shieldMax === b.shieldMax &&
    a.newRecord === b.newRecord &&
    a.elapsed === b.elapsed &&
    a.fps === b.fps
  );
}

class HudStore {
  private snapshot: HudSnapshot = EMPTY_HUD;
  private banners: Banner[] = [];
  private hudListeners = new Set<Listener>();
  private bannerListeners = new Set<Listener>();
  private nextBannerId = 1;
  private timers = new Map<number, ReturnType<typeof setTimeout>>();
  private resumeCount = 0;
  private resumeListeners = new Set<Listener>();

  // ── снимок HUD ──
  getSnapshot = (): HudSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.hudListeners.add(listener);
    return () => this.hudListeners.delete(listener);
  };

  /** Заменить снимок. Слушатели вызываются, только если что-то изменилось. */
  setSnapshot(next: HudSnapshot): void {
    if (sameHud(this.snapshot, next)) return;
    this.snapshot = next;
    this.hudListeners.forEach((l) => l());
  }

  resetSnapshot(): void {
    this.setSnapshot(EMPTY_HUD);
  }

  // ── баннеры ──
  getBanners = (): Banner[] => this.banners;

  subscribeBanners = (listener: Listener): (() => void) => {
    this.bannerListeners.add(listener);
    return () => this.bannerListeners.delete(listener);
  };

  /**
   * Показать баннер. Баннер того же вида заменяет предыдущий (например, новый
   * levelUp вытесняет старый). Через duration мс баннер снимается сам.
   */
  pushBanner(kind: BannerKind, text: string, sub?: string, duration = 1600): number {
    const id = this.nextBannerId++;
    const replaced = this.banners.filter((b) => b.kind === kind);
    for (const b of replaced) this.clearTimer(b.id);
    const banner: Banner = { id, kind, text, sub, createdAt: performance.now(), duration };
    this.banners = [...this.banners.filter((b) => b.kind !== kind), banner];
    this.timers.set(
      id,
      setTimeout(() => this.dismissBanner(id), duration),
    );
    this.emitBanners();
    return id;
  }

  dismissBanner(id: number): void {
    this.clearTimer(id);
    const next = this.banners.filter((b) => b.id !== id);
    if (next.length === this.banners.length) return;
    this.banners = next;
    this.emitBanners();
  }

  clearBanners(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
    if (this.banners.length === 0) return;
    this.banners = [];
    this.emitBanners();
  }

  // ── отсчёт после паузы ──
  getResumeCount = (): number => this.resumeCount;

  subscribeResumeCount = (listener: Listener): (() => void) => {
    this.resumeListeners.add(listener);
    return () => this.resumeListeners.delete(listener);
  };

  /** Цифра отсчёта после паузы (2, 1); 0 — отсчёта нет, тики идут. */
  setResumeCount(count: number): void {
    if (this.resumeCount === count) return;
    this.resumeCount = count;
    this.resumeListeners.forEach((l) => l());
  }

  private clearTimer(id: number): void {
    const t = this.timers.get(id);
    if (t !== undefined) clearTimeout(t);
    this.timers.delete(id);
  }

  private emitBanners(): void {
    this.bannerListeners.forEach((l) => l());
  }
}

export const hudStore = new HudStore();

/** Текущий снимок HUD (перерисовка только при изменениях). */
export function useHudSnapshot(): HudSnapshot {
  return useSyncExternalStore(hudStore.subscribe, hudStore.getSnapshot, hudStore.getSnapshot);
}

/** Активные баннеры (READY/GO, LEVEL UP, NEW RECORD! и т. д.). */
export function useBanners(): Banner[] {
  return useSyncExternalStore(hudStore.subscribeBanners, hudStore.getBanners, hudStore.getBanners);
}

/** Цифра отсчёта после паузы: сколько долей мир ещё стоит (2, 1); 0 — отсчёта нет. */
export function useResumeCount(): number {
  return useSyncExternalStore(hudStore.subscribeResumeCount, hudStore.getResumeCount, hudStore.getResumeCount);
}
