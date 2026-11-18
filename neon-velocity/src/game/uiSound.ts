/**
 * Развязка интерфейса и звука: кнопки зовут playUiSound(), а audio.ts при
 * загрузке регистрирует настоящий обработчик через setUiSoundHandler().
 * Так UI-примитивы не зависят от Web Audio напрямую.
 */
export type UiSound = 'hover' | 'click' | 'back' | 'buy' | 'equip' | 'error' | 'toggle';

let handler: ((sound: UiSound) => void) | null = null;

export function setUiSoundHandler(fn: ((sound: UiSound) => void) | null): void {
  handler = fn;
}

export function playUiSound(sound: UiSound): void {
  handler?.(sound);
}
