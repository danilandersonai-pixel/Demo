import type { LucideIcon } from 'lucide-react';
import { useId, type CSSProperties } from 'react';
import { formatPercent } from './shared';

export interface VolumeSliderProps {
  icon: LucideIcon;
  label: string;
  /** 0..1. */
  value: number;
  onChange(value: number): void;
  /** Ползунок отпущен (мышь, палец или клавиша) — момент для пробного звука. */
  onCommit?(): void;
  /** Звук выключен целиком: слайдер работает, но выглядит приглушённым. */
  muted?: boolean;
  /** Неоновый цвет дорожки (CSS-цвет). */
  color: string;
}

const STEP_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];

/**
 * Настоящий <input type="range"> в неоновой обёртке. Полностью управляемый:
 * значение приходит из сохранения, локального состояния и эффектов нет —
 * автоповтор клавиши даёт по одному обновлению на событие и не может
 * зациклить React вложенными обновлениями.
 */
export function VolumeSlider({ icon: Icon, label, value, onChange, onCommit, muted = false, color }: VolumeSliderProps) {
  const id = useId();
  const percent = Math.round(value * 100);
  const style = { '--fill': `${percent}%`, '--c': color } as CSSProperties;
  return (
    <div
      className={[
        'rounded-[3px] border border-white/10 bg-void/50 px-3 pb-1 pt-2.5 transition-opacity duration-200 sm:px-4',
        muted ? 'opacity-55' : '',
      ].join(' ')}
    >
      <div className="flex items-center gap-2">
        <Icon size={16} strokeWidth={2.2} style={{ color }} className="shrink-0" aria-hidden />
        <label htmlFor={id} className="flex-1 text-xs font-bold uppercase tracking-widest text-ink sm:text-[13px]">
          {label}
        </label>
        <span className="nvm-digits text-sm font-bold tracking-wider" style={{ color }} aria-hidden>
          {formatPercent(value)}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={5}
        value={percent}
        aria-valuetext={muted ? `${percent} процентов, звук выключен` : `${percent} процентов`}
        style={style}
        className="nvm-range mt-0.5"
        onChange={(e) => {
          const next = Number(e.currentTarget.value) / 100;
          if (next !== value) onChange(next);
        }}
        onPointerUp={() => onCommit?.()}
        onKeyUp={(e) => {
          if (STEP_KEYS.includes(e.key)) onCommit?.();
        }}
      />
    </div>
  );
}
