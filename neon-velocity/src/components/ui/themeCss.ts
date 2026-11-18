import type { Theme } from '../../game/types';

/**
 * Прокинуть акценты текущей темы в CSS-переменные --theme-a/b/c —
 * их используют утилиты text-theme-a, box-glow-theme, text-glow-theme и т. д.
 */
export function applyThemeCss(theme: Theme): void {
  const root = document.documentElement.style;
  root.setProperty('--theme-a', theme.colors.accent);
  root.setProperty('--theme-b', theme.colors.accent2);
  root.setProperty('--theme-c', theme.colors.accent3);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme.colors.bg);
}
