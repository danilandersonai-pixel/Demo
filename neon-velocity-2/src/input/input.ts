/**
 * Ввод игрока: клавиатура (window) и указатель (холст) → один InputFrame на тик.
 *
 *  • Клавиатура: ←/→ и A/D по e.code; рулит последняя нажатая (keys.ts).
 *  • Мышь ведёт корабль простым движением, без клика.
 *  • Палец и перо — касанием и ведением; управляет последний опущенный палец,
 *    а когда его поднимают, управление переходит к оставшемуся (pointers.ts).
 *
 * source — устройство, которым управляли последним. Положение указателя после
 * отпускания и ухода мыши сохраняется: корабль остаётся там, куда его привели.
 *
 * Пока ввод выключен (меню, пауза), кадр нейтральный и ни одно событие не
 * отменяется. Зажатые клавиши и пальцы при этом продолжают учитываться — иначе
 * клавиша, отпущенная на паузе, «залипла» бы, — но корабль они не двигают:
 * движение мыши к кнопке «Продолжить» не должно увести корабль после паузы.
 */
import type { InputFrame } from '../core/types';
import { SteerKeys, steerDirection } from './keys';
import { TouchStack } from './pointers';

/**
 * Насколько мышь должна сдвинуться (CSS-пиксели), чтобы забрать управление у
 * клавиатуры: дрожание мыши от ударов по клавишам корабль не уводит.
 */
const MOUSE_WAKE_PX = 4;

/** Фокус в поле ввода — клавиши принадлежат ему, а не кораблю. */
function isEditable(el: EventTarget | null): boolean {
  const node = el as Partial<HTMLElement> | null;
  if (!node || typeof node.tagName !== 'string') return false;
  return node.isContentEditable === true || /^(INPUT|TEXTAREA|SELECT)$/i.test(node.tagName);
}

export class InputController {
  private target: HTMLElement | null = null;
  private toRoadX: (clientX: number) => number = () => Number.NaN;
  private listeners: AbortController | null = null;
  /** touch-action холста до attach() — возвращается в detach(). */
  private savedTouchAction = '';
  private enabled = true;

  private readonly keys = new SteerKeys();
  private readonly touches = new TouchStack();
  private pointerX: number | null = null;
  private source: InputFrame['source'] = 'none';
  /** Последний экранный X мыши и X, на котором она «уснула», когда рулить стала клавиатура. */
  private mouseX: number | null = null;
  private mouseRestX: number | null = null;
  /** Кадр переиспользуется: frame() зовут на каждом тике. */
  private readonly out: InputFrame = { axis: 0, pointerX: null, source: 'none' };

  /**
   * Подписаться на клавиатуру (window) и указатель (target).
   * toRoadX переводит clientX события в X на дороге (см. screenToRoadX).
   * Повторный вызов с тем же target только обновляет toRoadX.
   */
  attach(target: HTMLElement, toRoadX: (clientX: number) => number): void {
    this.toRoadX = toRoadX;
    if (this.target === target && this.listeners) return;
    this.detach();
    this.target = target;
    const ac = new AbortController();
    this.listeners = ac;
    const signal = ac.signal;
    // Без этого браузер забирает ведение пальцем себе (прокрутка, масштаб) и шлёт pointercancel.
    this.savedTouchAction = target.style.touchAction;
    target.style.touchAction = 'none';

    window.addEventListener('keydown', this.onKeyDown, { signal });
    window.addEventListener('keyup', this.onKeyUp, { signal });
    window.addEventListener('blur', this.onBlur, { signal });
    target.addEventListener('pointerdown', this.onPointerDown, { signal });
    target.addEventListener('pointermove', this.onPointerMove, { signal });
    target.addEventListener('pointerup', this.onPointerEnd, { signal });
    target.addEventListener('pointercancel', this.onPointerEnd, { signal });
    target.addEventListener('contextmenu', this.onContextMenu, { signal });
  }

  /** Снять все слушатели. */
  detach(): void {
    const target = this.target;
    this.listeners?.abort();
    this.listeners = null;
    this.target = null;
    if (target) {
      for (const id of this.touches.active()) {
        try {
          target.releasePointerCapture(id);
        } catch {
          // Захват уже снят браузером — нечего делать.
        }
      }
      target.style.touchAction = this.savedTouchAction;
    }
    this.reset();
  }

  /** Вне забега ввод выключен: кадр нейтральный, preventDefault не вызывается. */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    // Клавиша, зажатая к моменту включения (игрок держит её, снимая паузу), — это уже руление.
    if (enabled && this.keys.axis !== 0) this.takeKeyboard();
  }

  /** Ввод на текущий тик. Возвращается один и тот же объект — не хранить между тиками. */
  frame(): InputFrame {
    const f = this.out;
    if (this.enabled) {
      f.axis = this.keys.axis;
      f.pointerX = this.pointerX;
      f.source = this.source;
    } else {
      f.axis = 0;
      f.pointerX = null;
      f.source = 'none';
    }
    return f;
  }

  /** Сбросить зажатые клавиши и указатель (старт забега, потеря фокуса). */
  reset(): void {
    this.keys.clear();
    this.touches.clear();
    this.pointerX = null;
    this.source = 'none';
    this.mouseRestX = null;
  }

  // ── Клавиатура ──

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (steerDirection(e.code) === 0) return;
    // Сочетания (Alt+←, Cmd+→) и ввод в поля — не руление.
    if (e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
    const fresh = this.keys.press(e.code);
    if (!this.enabled) return;
    // Автоповтор зажатой клавиши не отбирает управление у мыши — только новое нажатие.
    if (fresh || !e.repeat) this.takeKeyboard();
    // Стрелки иначе прокручивают страницу.
    if (e.code.startsWith('Arrow') && e.cancelable) e.preventDefault();
  };

  /** Управление переходит к клавиатуре; мышь «засыпает» там, где стоит. */
  private takeKeyboard(): void {
    if (this.source === 'keyboard') return;
    this.source = 'keyboard';
    this.mouseRestX = this.mouseX;
  }

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.release(e.code);
  };

  /** Окно потеряло фокус: keyup уже не придёт, клавиши считаются отпущенными. */
  private readonly onBlur = (): void => {
    this.keys.clear();
  };

  // ── Указатель ──

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') {
      this.mouseX = e.clientX;
      if (this.enabled) this.steerTo(e.clientX);
      return;
    }
    this.touches.down(e.pointerId, e.clientX);
    if (!this.enabled) return;
    try {
      this.target?.setPointerCapture(e.pointerId);
    } catch {
      // Указатель уже неактивен (касание отменено) — ведение просто не начнётся.
    }
    this.steerTo(e.clientX);
    // Иначе браузер досылает «совместимые» события мыши и выделяет текст.
    if (e.cancelable) e.preventDefault();
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') {
      this.mouseX = e.clientX;
      if (!this.enabled) return;
      // Пока рулит клавиатура, мышь «спит» и просыпается только от заметного движения.
      const rest = this.source === 'keyboard' ? this.mouseRestX : null;
      if (rest !== null && Math.abs(e.clientX - rest) < MOUSE_WAKE_PX) return;
      this.steerTo(e.clientX);
      return;
    }
    // Перо над экраном и не управляющие пальцы корабль не ведут.
    if (this.touches.move(e.pointerId, e.clientX) && this.enabled) this.steerTo(e.clientX);
  };

  private readonly onPointerEnd = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') return;
    const next = this.touches.up(e.pointerId);
    if (next !== null && this.enabled) this.steerTo(next);
  };

  /** Долгое касание и правый клик не должны открывать меню поверх забега. */
  private readonly onContextMenu = (e: Event): void => {
    if (this.enabled && e.cancelable) e.preventDefault();
  };

  private steerTo(clientX: number): void {
    const x = this.toRoadX(clientX);
    if (!Number.isFinite(x)) return;
    this.pointerX = x;
    this.source = 'pointer';
  }
}
