import { LayoutGroup, motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { useId, useRef, type KeyboardEvent } from 'react';
import { playUiSound } from '../../game/uiSound';
import { tabId, tabPanelId } from './shared';

export interface TabDef<T extends string> {
  id: T;
  label: string;
  icon: LucideIcon;
  /** Маленький счётчик справа от подписи: «2/5». */
  badge?: string;
}

export interface TabBarProps<T extends string> {
  tabs: readonly TabDef<T>[];
  active: T;
  onChange(id: T): void;
  /** Префикс id вкладок и панелей для aria-controls / aria-labelledby. */
  idPrefix: string;
  label: string;
  className?: string;
}

/**
 * Вкладки в аркадном стиле: подсветка и неоновая черта «переезжают» к активной
 * вкладке (layoutId). Клавиатура по WAI-ARIA: ←/→, Home/End.
 */
export function TabBar<T extends string>({ tabs, active, onChange, idPrefix, label, className = '' }: TabBarProps<T>) {
  const groupId = useId();
  const refs = useRef(new Map<T, HTMLButtonElement>());

  const select = (id: T, focus: boolean) => {
    if (id !== active) {
      playUiSound('click');
      onChange(id);
    }
    if (focus) refs.current.get(id)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((t) => t.id === active);
    let next = -1;
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    select(tabs[next].id, true);
  };

  return (
    <LayoutGroup id={groupId}>
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className={['relative flex rounded-[3px] border border-white/10 bg-void/60 p-1', className].join(' ')}
      >
        {tabs.map((tab) => {
          const selected = tab.id === active;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                if (el) refs.current.set(tab.id, el);
                else refs.current.delete(tab.id);
              }}
              type="button"
              role="tab"
              id={tabId(idPrefix, tab.id)}
              aria-selected={selected}
              aria-controls={tabPanelId(idPrefix, tab.id)}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(tab.id, false)}
              onMouseEnter={() => {
                if (!selected) playUiSound('hover');
              }}
              // flex-auto, а не flex-1: вкладка растёт от ширины своей подписи. Равные трети
              // на 360px уже длинного слова — «Улучшения» резалась в «УЛУЧШЕН…» даже активной.
              className={[
                'relative flex h-10 min-w-0 flex-auto items-center justify-center gap-1 rounded-[2px] px-1.5 sm:gap-2 sm:px-4',
                'font-mono text-[11px] font-bold uppercase tracking-wider transition-colors duration-150 sm:text-xs sm:tracking-widest',
                selected ? 'text-theme-a text-glow-theme' : 'text-ink-dim hover:text-ink',
              ].join(' ')}
            >
              {selected && (
                <motion.span
                  layoutId="tab-glow"
                  aria-hidden
                  className="absolute inset-0 rounded-[2px] bg-theme-a/10"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                />
              )}
              {selected && (
                <motion.span
                  layoutId="tab-line"
                  aria-hidden
                  className="absolute inset-x-2 -bottom-1 h-0.5 rounded-full bg-theme-a shadow-[0_0_10px_var(--theme-a),0_0_2px_#fff]"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                />
              )}
              <Icon size={15} strokeWidth={2.3} className="relative shrink-0" aria-hidden />
              <span className="relative truncate">{tab.label}</span>
              {tab.badge && (
                <span
                  className={[
                    'nvm-digits relative hidden rounded-[2px] px-1 text-[10px] tracking-normal sm:inline',
                    selected ? 'bg-theme-a/15 text-theme-a' : 'bg-white/5 text-ink-faint',
                  ].join(' ')}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
