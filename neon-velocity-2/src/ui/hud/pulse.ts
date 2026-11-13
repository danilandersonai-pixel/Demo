/**
 * Доли ритма для HUD. Игровой цикл сообщает сюда каждую долю забега, а
 * компоненты отвечают на неё короткой анимацией прямо на DOM-узле (Web
 * Animations) — без состояния React и без перерисовок.
 */
import { useEffect, useRef } from 'react';

export interface HudBeat {
  /** Номер доли от GO (во вступлении −4…−1). */
  beat: number;
  /** Доля внутри такта: 0..3. */
  beatInBar: number;
  level: number;
}

type Listener = (beat: HudBeat) => void;

const listeners = new Set<Listener>();

export const hudPulse = {
  emit(beat: HudBeat): void {
    listeners.forEach((l) => l(beat));
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** Подписка на доли на время жизни компонента; сам обработчик можно менять между рендерами. */
export function useBeat(listener: Listener): void {
  const latest = useRef(listener);
  useEffect(() => {
    latest.current = listener;
  });
  useEffect(() => hudPulse.subscribe((beat) => latest.current(beat)), []);
}

let motionQuery: MediaQueryList | null = null;

/** Пользователь просит меньше движения (читается на лету — настройку могут сменить посреди игры). */
export function prefersReducedMotion(): boolean {
  try {
    motionQuery ??= window.matchMedia('(prefers-reduced-motion: reduce)');
    return motionQuery.matches;
  } catch {
    return false;
  }
}

const PULSE_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';

/**
 * Разовая вспышка на узле: кадры Web Animations поверх его обычных стилей.
 * При «меньше движения» ничего не делает — глобальное правило index.css на
 * Web Animations не действует.
 */
export function pulse(el: Element | null, keyframes: Keyframe[], duration: number): void {
  if (!el || typeof el.animate !== 'function' || prefersReducedMotion()) return;
  el.animate(keyframes, { duration, easing: PULSE_EASING });
}
