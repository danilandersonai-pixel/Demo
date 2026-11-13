import type { LucideIcon } from 'lucide-react';
import { useId } from 'react';
import { playUiSound } from '../../audio/uiSound';

export interface SwitchRowProps {
  icon: LucideIcon;
  label: string;
  description?: string;
  checked: boolean;
  onChange(next: boolean): void;
  /**
   * Без своего щелчка — для выключателя звука: щелчок прозвучал бы по старой
   * настройке (в заглушённый микшер), а включение подтверждает сам AudioEngine.
   */
  silent?: boolean;
}

/**
 * Строка настройки с неоновым переключателем (role="switch"). Нажимается вся строка.
 */
export function SwitchRow({ icon: Icon, label, description, checked, onChange, silent = false }: SwitchRowProps) {
  const labelId = useId();
  const descId = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      aria-describedby={description ? descId : undefined}
      onClick={() => {
        if (!silent) playUiSound('toggle');
        onChange(!checked);
      }}
      onMouseEnter={() => playUiSound('hover')}
      className="group flex w-full items-center gap-3 rounded-[3px] border border-white/10 bg-void/50 px-3 py-2.5 text-left transition-colors duration-150 hover:border-white/25 hover:bg-white/[0.04] sm:px-4"
    >
      <span
        className={[
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-[3px] border transition-colors duration-200',
          checked ? 'border-theme-a/60 bg-theme-a/10 text-theme-a' : 'border-white/10 bg-white/[0.03] text-ink-faint',
        ].join(' ')}
      >
        <Icon size={18} strokeWidth={2.2} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span id={labelId} className="block text-xs font-bold uppercase tracking-widest text-ink sm:text-[13px]">
          {label}
        </span>
        {description && (
          <span id={descId} className="mt-0.5 block text-[11px] leading-snug text-ink-dim">
            {description}
          </span>
        )}
      </span>
      {/* Ползунок едет CSS-переходом: без измерений раскладки он не «прыгает» при прокрутке панели. */}
      <span
        aria-hidden
        className={[
          'relative h-6 w-11 shrink-0 rounded-[4px] border transition-colors duration-200',
          checked ? 'border-theme-a bg-theme-a/20 shadow-[0_0_12px_color-mix(in_srgb,var(--theme-a)_45%,transparent)]' : 'border-ink-faint/70 bg-void',
        ].join(' ')}
      >
        <span
          className={[
            'absolute left-[3px] top-[3px] block h-4 w-4 rounded-[2px] transition-transform duration-200 ease-out',
            checked ? 'translate-x-5 bg-theme-a shadow-[0_0_10px_var(--theme-a),0_0_2px_#fff]' : 'bg-ink-faint',
          ].join(' ')}
        />
      </span>
      <span
        aria-hidden
        className={['nvm-digits w-9 shrink-0 text-right text-[10px] font-bold tracking-widest', checked ? 'text-theme-a' : 'text-ink-faint'].join(' ')}
      >
        {checked ? 'ВКЛ' : 'ВЫКЛ'}
      </span>
    </button>
  );
}
