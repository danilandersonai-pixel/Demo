/**
 * Ввод игрока: клавиатура на window и указатель на холсте.
 *
 * Клавиатура: ← / → и A / D (по физическим клавишам event.code — работает и в
 * русской раскладке). Зажатые клавиши хранятся стеком в порядке нажатия:
 * при двух зажатых побеждает последняя, отпускание возвращает предыдущую.
 * Мышь ведёт корабль простым движением, палец и перо — касанием и ведением
 * (с захватом указателя). После отпускания пальца или ухода мыши с холста
 * pointerX сохраняет последнее значение — корабль доезжает и останавливается.
 * lastSource — устройство, которым игрок пользовался последним.
 */
import type { InputState } from './types';

type Dir = -1 | 1;
type Source = InputState['lastSource'];

/** Клавиши управления по event.code. */
const KEY_DIRS: Readonly<Record<string, Dir>> = {
  ArrowLeft: -1,
  KeyA: -1,
  ArrowRight: 1,
  KeyD: 1,
};

/** Запасной путь по event.key — экранные клавиатуры и браузеры без event.code. */
const KEY_FALLBACK: Readonly<Record<string, string>> = {
  ArrowLeft: 'ArrowLeft',
  Left: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  Right: 'ArrowRight',
  a: 'KeyA',
  A: 'KeyA',
  ф: 'KeyA',
  Ф: 'KeyA',
  d: 'KeyD',
  D: 'KeyD',
  в: 'KeyD',
  В: 'KeyD',
};

/** Стрелки прокручивают страницу — им нужен preventDefault; буквам — нет. */
const ARROWS = new Set(['ArrowLeft', 'ArrowRight']);

/**
 * Насколько (CSS-пикселей) должна сдвинуться мышь, чтобы забрать управление у
 * клавиатуры: дрожание мыши на столе не должно перебивать стрелки.
 */
const MOUSE_TAKEOVER_PX = 4;

const NEUTRAL: Readonly<InputState> = { axis: 0, pointerX: null, lastSource: 'none' };

function controlCode(e: KeyboardEvent): string | null {
  if (e.code && Object.hasOwn(KEY_DIRS, e.code)) return e.code;
  if ((!e.code || e.code === 'Unidentified') && Object.hasOwn(KEY_FALLBACK, e.key)) return KEY_FALLBACK[e.key];
  return null;
}

/** Фокус в поле ввода: стрелки и буквы принадлежат ему, а не игре. */
function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export class InputController {
  private target: HTMLElement | null = null;
  private toWorldX: (clientX: number) => number = (x) => x;
  private listeners: AbortController | null = null;
  private enabled = true;
  /** Зажатые клавиши управления в порядке нажатия (последняя — главная). */
  private held: string[] = [];
  private pointerX: number | null = null;
  private lastSource: Source = 'none';
  /** Палец или перо, захваченные холстом. */
  private touchId: number | null = null;
  /** Последний clientX мыши над холстом. */
  private mouseClientX: number | null = null;
  /** clientX мыши в момент, когда управление перешло к клавиатуре. */
  private mouseAnchor: number | null = null;

  /**
   * Подписаться на клавиатуру (window) и указатель (target).
   * toWorldX переводит clientX события в мировой X.
   */
  attach(target: HTMLElement, toWorldX: (clientX: number) => number): void {
    this.toWorldX = toWorldX;
    // Повторный вызов с тем же элементом лишь обновляет пересчёт координат.
    if (this.listeners && this.target === target) return;
    this.detach();
    this.target = target;
    const ac = new AbortController();
    this.listeners = ac;
    const signal = ac.signal;
    window.addEventListener('keydown', this.onKeyDown, { signal });
    window.addEventListener('keyup', this.onKeyUp, { signal });
    window.addEventListener('blur', this.onBlur, { signal });
    document.addEventListener('visibilitychange', this.onVisibility, { signal });
    target.addEventListener('pointermove', this.onPointerMove, { signal });
    target.addEventListener('pointerdown', this.onPointerDown, { signal });
    target.addEventListener('pointerup', this.onPointerEnd, { signal });
    target.addEventListener('pointercancel', this.onPointerEnd, { signal });
    target.addEventListener('lostpointercapture', this.onLostCapture, { signal });
    // passive: false — иначе iOS не даст отменить прокрутку и масштаб при ведении пальцем.
    target.addEventListener('touchmove', this.onTouchMove, { signal, passive: false });
    target.addEventListener('contextmenu', this.onContextMenu, { signal });
  }

  /** Снять все слушатели. */
  detach(): void {
    this.listeners?.abort();
    this.listeners = null;
    this.reset();
    this.target = null;
  }

  /** Вне забега ввод выключен: состояние нейтральное, preventDefault не вызывается. */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    // Указатель забывается в обе стороны: за время паузы мышь могла уйти к кнопкам.
    this.releaseTouch();
    this.pointerX = null;
    // Клавиши отслеживаются и в выключенном состоянии — зажатая стрелка сразу работает после паузы.
    this.lastSource = enabled && this.held.length > 0 ? 'keyboard' : 'none';
    this.mouseAnchor = this.lastSource === 'keyboard' ? this.mouseClientX : null;
  }

  getState(): InputState {
    if (!this.enabled) return { ...NEUTRAL };
    return { axis: this.axis(), pointerX: this.pointerX, lastSource: this.lastSource };
  }

  /** Сбросить зажатые клавиши и указатель (старт забега, потеря фокуса). */
  reset(): void {
    this.held.length = 0;
    this.releaseTouch();
    this.pointerX = null;
    this.lastSource = 'none';
    this.mouseAnchor = null;
  }

  // ── Внутреннее ──

  private axis(): number {
    const last = this.held[this.held.length - 1];
    return last === undefined ? 0 : KEY_DIRS[last];
  }

  private releaseTouch(): void {
    const id = this.touchId;
    this.touchId = null;
    const target = this.target;
    if (id === null || !target) return;
    try {
      if (target.hasPointerCapture(id)) target.releasePointerCapture(id);
    } catch {
      // Указатель уже исчез (палец убран) — захвата нет, отпускать нечего.
    }
  }

  private setPointer(clientX: number): void {
    const x = this.toWorldX(clientX);
    if (Number.isFinite(x)) this.pointerX = x;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const code = controlCode(e);
    if (!code || e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
    const i = this.held.indexOf(code);
    // Автоповтор не меняет порядок, но возвращает клавишу, зажатую до сброса.
    if (!e.repeat || i < 0) {
      if (i >= 0) this.held.splice(i, 1);
      this.held.push(code);
    }
    if (!this.enabled) return;
    if (this.lastSource !== 'keyboard') this.mouseAnchor = this.mouseClientX;
    this.lastSource = 'keyboard';
    if (ARROWS.has(code)) e.preventDefault();
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const code = controlCode(e);
    if (!code) return;
    const i = this.held.indexOf(code);
    if (i >= 0) this.held.splice(i, 1);
  };

  private readonly onBlur = (): void => {
    this.reset();
  };

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden') this.reset();
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse') {
      this.mouseClientX = e.clientX;
      this.setPointer(e.clientX);
      if (this.lastSource !== 'pointer') {
        const anchor = this.mouseAnchor;
        if (anchor === null || Math.abs(e.clientX - anchor) >= MOUSE_TAKEOVER_PX) {
          this.lastSource = 'pointer';
          this.mouseAnchor = null;
        }
      }
      return;
    }
    // Палец и перо ведут корабль только в касании.
    if (e.pointerId !== this.touchId) return;
    this.setPointer(e.clientX);
    this.lastSource = 'pointer';
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse') {
      if (e.button !== 0) return;
      this.mouseClientX = e.clientX;
      this.mouseAnchor = null;
      this.setPointer(e.clientX);
      this.lastSource = 'pointer';
      return;
    }
    // Новый палец перехватывает управление у предыдущего.
    this.releaseTouch();
    this.touchId = e.pointerId;
    const target = this.target;
    if (target) {
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        // Указатель уже не активен (касание оборвалось) — ведём без захвата.
      }
    }
    this.setPointer(e.clientX);
    this.lastSource = 'pointer';
  };

  private readonly onPointerEnd = (e: PointerEvent): void => {
    if (e.pointerId === this.touchId) this.releaseTouch();
  };

  private readonly onLostCapture = (e: PointerEvent): void => {
    if (e.pointerId === this.touchId) this.touchId = null;
  };

  private readonly onTouchMove = (e: TouchEvent): void => {
    if (this.enabled && e.cancelable && !isEditable(document.activeElement)) e.preventDefault();
  };

  /** Правый клик или долгое касание в забеге не должны открывать меню браузера и уводить фокус. */
  private readonly onContextMenu = (e: Event): void => {
    if (this.enabled) e.preventDefault();
  };
}
