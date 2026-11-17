/**
 * Ввод: чистые трекеры клавиш и пальцев и сам InputController на поддельных
 * window и холсте (в настоящем браузере те же переходы проверяет Playwright).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputController, MOUSE_WAKE_PX } from './input';
import { SteerKeys, steerDirection } from './keys';
import { TouchStack } from './pointers';

type Handler = (event: unknown) => void;

/** Минимальная цель событий: помнит слушателей и уважает signal из AbortController. */
class FakeTarget {
  readonly handlers = new Map<string, Set<Handler>>();
  readonly style = { touchAction: 'pan-y' };
  readonly captured: number[] = [];
  readonly released: number[] = [];

  addEventListener(type: string, fn: Handler, options?: { signal?: AbortSignal }): void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn);
    options?.signal?.addEventListener('abort', () => set.delete(fn));
  }

  setPointerCapture(id: number): void {
    this.captured.push(id);
  }

  releasePointerCapture(id: number): void {
    this.released.push(id);
  }

  count(): number {
    let n = 0;
    for (const set of this.handlers.values()) n += set.size;
    return n;
  }

  /** Отправить событие; возвращает, был ли вызван preventDefault. */
  emit(type: string, init: Record<string, unknown> = {}): boolean {
    let prevented = false;
    const event = {
      type,
      cancelable: true,
      repeat: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      target: null,
      preventDefault: () => {
        prevented = true;
      },
      ...init,
    };
    for (const fn of [...(this.handlers.get(type) ?? [])]) fn(event);
    return prevented;
  }
}

/** clientX → X на дороге: экран 1000 px = дорога 100 единиц. */
const toRoadX = (clientX: number): number => clientX / 10;

describe('SteerKeys', () => {
  it('знает клавиши руления по e.code', () => {
    expect(steerDirection('ArrowLeft')).toBe(-1);
    expect(steerDirection('KeyA')).toBe(-1);
    expect(steerDirection('ArrowRight')).toBe(1);
    expect(steerDirection('KeyD')).toBe(1);
    expect(steerDirection('KeyW')).toBe(0);
    expect(steerDirection('toString')).toBe(0);
  });

  it('обе нажаты — побеждает последняя; отпускание возвращает другую', () => {
    const k = new SteerKeys();
    expect(k.axis).toBe(0);
    expect(k.press('ArrowLeft')).toBe(true);
    expect(k.axis).toBe(-1);
    expect(k.press('ArrowRight')).toBe(true);
    expect(k.axis).toBe(1);
    // Автоповтор первой клавиши порядок не меняет.
    expect(k.press('ArrowLeft')).toBe(false);
    expect(k.axis).toBe(1);
    k.release('ArrowRight');
    expect(k.axis).toBe(-1);
    k.release('ArrowLeft');
    expect(k.axis).toBe(0);
  });

  it('A и ← вместе — одно направление, пока зажата хотя бы одна', () => {
    const k = new SteerKeys();
    k.press('KeyA');
    k.press('ArrowLeft');
    k.release('KeyA');
    expect(k.axis).toBe(-1);
    k.press('KeyD');
    expect(k.axis).toBe(1);
    k.clear();
    expect(k.axis).toBe(0);
    expect(k.press('Space')).toBe(false);
    k.release('KeyD');
    expect(k.axis).toBe(0);
  });
});

describe('TouchStack', () => {
  it('управляет последний опущенный палец; после подъёма — оставшийся, там, где он сейчас', () => {
    const t = new TouchStack();
    t.down(1, 100);
    expect(t.move(1, 120)).toBe(true);
    t.down(2, 800);
    expect(t.move(1, 140)).toBe(false);
    expect(t.move(2, 820)).toBe(true);
    // Поднят управляющий — управление у первого, в его последнем положении.
    expect(t.up(2)).toBe(140);
    expect(t.move(1, 150)).toBe(true);
    expect(t.up(1)).toBeNull();
    expect(t.size).toBe(0);
  });

  it('подъём не управляющего пальца управление не меняет', () => {
    const t = new TouchStack();
    t.down(1, 100);
    t.down(2, 800);
    expect(t.up(1)).toBeNull();
    expect(t.move(2, 810)).toBe(true);
    expect(t.up(7)).toBeNull();
    expect(t.move(7, 5)).toBe(false);
    expect([...t.active()]).toEqual([2]);
  });

  it('три пальца: управление идёт по стеку', () => {
    const t = new TouchStack();
    t.down(1, 10);
    t.down(2, 20);
    t.down(3, 30);
    expect(t.up(3)).toBe(20);
    expect(t.up(2)).toBe(10);
    t.down(1, 55);
    expect(t.size).toBe(1);
    t.clear();
    expect(t.size).toBe(0);
  });
});

describe('InputController', () => {
  let win: FakeTarget;
  let canvas: FakeTarget;
  let input: InputController;

  beforeEach(() => {
    win = new FakeTarget();
    canvas = new FakeTarget();
    vi.stubGlobal('window', win);
    input = new InputController();
    input.attach(canvas as unknown as HTMLElement, toRoadX);
  });

  afterEach(() => {
    input.detach();
    vi.unstubAllGlobals();
  });

  const key = (type: 'keydown' | 'keyup', code: string, init: Record<string, unknown> = {}) => win.emit(type, { code, ...init });
  const pointer = (type: string, pointerType: string, pointerId: number, clientX: number) => canvas.emit(type, { pointerType, pointerId, clientX });
  const mouse = (clientX: number) => pointer('pointermove', 'mouse', 1, clientX);
  /** Разбудить спящую мышь и привести её в clientX: первое событие — точка покоя, второе — заметное движение. */
  const mouseTo = (clientX: number) => {
    mouse(clientX - 3 * MOUSE_WAKE_PX);
    mouse(clientX);
  };

  it('до любого ввода кадр нейтральный', () => {
    expect(input.frame()).toEqual({ axis: 0, pointerX: null, source: 'none' });
  });

  it('клавиатура: последняя нажатая побеждает, отпускание возвращает другую', () => {
    key('keydown', 'ArrowLeft');
    expect(input.frame()).toEqual({ axis: -1, pointerX: null, source: 'keyboard' });
    key('keydown', 'KeyD');
    expect(input.frame().axis).toBe(1);
    key('keyup', 'KeyD');
    expect(input.frame().axis).toBe(-1);
    key('keyup', 'ArrowLeft');
    expect(input.frame()).toEqual({ axis: 0, pointerX: null, source: 'keyboard' });
  });

  it('стрелки отменяются только при включённом вводе и не в поле ввода; A/D не отменяются', () => {
    expect(key('keydown', 'ArrowLeft')).toBe(true);
    expect(key('keydown', 'KeyA')).toBe(false);
    key('keyup', 'ArrowLeft');
    key('keyup', 'KeyA');
    const field = { tagName: 'INPUT', isContentEditable: false };
    expect(key('keydown', 'ArrowRight', { target: field })).toBe(false);
    expect(input.frame().axis).toBe(0);
    expect(key('keydown', 'ArrowRight', { target: { tagName: 'DIV', isContentEditable: true } })).toBe(false);
    expect(key('keydown', 'ArrowRight', { altKey: true })).toBe(false);
    expect(key('keydown', 'ArrowRight', { metaKey: true })).toBe(false);
    expect(input.frame().axis).toBe(0);
    expect(key('keydown', 'Space')).toBe(false);
    input.setEnabled(false);
    expect(key('keydown', 'ArrowRight')).toBe(false);
  });

  it('blur окна сбрасывает зажатые клавиши', () => {
    key('keydown', 'ArrowRight');
    expect(input.frame().axis).toBe(1);
    win.emit('blur');
    expect(input.frame().axis).toBe(0);
    // Автоповтор всё ещё зажатой клавиши возвращает её.
    key('keydown', 'ArrowRight', { repeat: true });
    expect(input.frame().axis).toBe(1);
  });

  it('мышь ведёт движением без клика; значение сохраняется после ухода', () => {
    // Первое событие только отмечает, где лежит мышь; рулит уже второе, заметное движение.
    mouse(238);
    expect(input.frame()).toEqual({ axis: 0, pointerX: null, source: 'none' });
    mouse(250);
    expect(input.frame()).toEqual({ axis: 0, pointerX: 25, source: 'pointer' });
    pointer('pointermove', 'mouse', 1, 700);
    expect(input.frame().pointerX).toBe(70);
    canvas.emit('pointerleave', { pointerType: 'mouse', pointerId: 1, clientX: 990 });
    expect(input.frame()).toEqual({ axis: 0, pointerX: 70, source: 'pointer' });
    expect(canvas.captured).toEqual([]);
  });

  it('source — последнее устройство; дрожание мыши не отбирает управление у клавиатуры', () => {
    mouseTo(500);
    key('keydown', 'ArrowLeft');
    expect(input.frame()).toEqual({ axis: -1, pointerX: 50, source: 'keyboard' });
    pointer('pointermove', 'mouse', 1, 502);
    expect(input.frame().source).toBe('keyboard');
    // Автоповтор клавиши не мешает мыши забрать управление заметным движением.
    pointer('pointermove', 'mouse', 1, 520);
    expect(input.frame()).toEqual({ axis: -1, pointerX: 52, source: 'pointer' });
    key('keydown', 'ArrowLeft', { repeat: true });
    expect(input.frame().source).toBe('pointer');
    key('keyup', 'ArrowLeft');
    key('keydown', 'ArrowRight');
    expect(input.frame()).toEqual({ axis: 1, pointerX: 52, source: 'keyboard' });
    // Клик мышью — управление сразу, без порога.
    pointer('pointerdown', 'mouse', 1, 521);
    expect(input.frame().source).toBe('pointer');
  });

  it('палец: касание и ведение с захватом указателя; после отпускания значение сохраняется', () => {
    expect(pointer('pointerdown', 'touch', 5, 300)).toBe(true);
    expect(canvas.captured).toEqual([5]);
    expect(input.frame()).toEqual({ axis: 0, pointerX: 30, source: 'pointer' });
    pointer('pointermove', 'touch', 5, 640);
    expect(input.frame().pointerX).toBe(64);
    pointer('pointerup', 'touch', 5, 640);
    expect(input.frame()).toEqual({ axis: 0, pointerX: 64, source: 'pointer' });
    // Движение уже поднятого пальца (или пера над экраном) корабль не ведёт.
    pointer('pointermove', 'pen', 9, 100);
    expect(input.frame().pointerX).toBe(64);
  });

  it('мультитач: управляет последний палец; когда он поднят — оставшийся', () => {
    pointer('pointerdown', 'touch', 1, 200);
    pointer('pointerdown', 'touch', 2, 800);
    expect(input.frame().pointerX).toBe(80);
    pointer('pointermove', 'touch', 1, 260);
    expect(input.frame().pointerX).toBe(80);
    pointer('pointermove', 'touch', 2, 760);
    expect(input.frame().pointerX).toBe(76);
    pointer('pointerup', 'touch', 2, 760);
    expect(input.frame().pointerX).toBe(26);
    pointer('pointermove', 'touch', 1, 310);
    expect(input.frame().pointerX).toBe(31);
    // Второй палец снова опущен и отменён системой — управление опять у первого.
    pointer('pointerdown', 'touch', 3, 900);
    expect(input.frame().pointerX).toBe(90);
    pointer('pointercancel', 'touch', 3, 900);
    expect(input.frame().pointerX).toBe(31);
    pointer('pointerup', 'touch', 1, 310);
    expect(input.frame()).toEqual({ axis: 0, pointerX: 31, source: 'pointer' });
  });

  it('setEnabled(false): нейтральный кадр, ничего не отменяется, корабль не уводится', () => {
    mouseTo(400);
    key('keydown', 'ArrowLeft');
    input.setEnabled(false);
    expect(input.frame()).toEqual({ axis: 0, pointerX: null, source: 'none' });
    expect(pointer('pointerdown', 'touch', 4, 900)).toBe(false);
    expect(canvas.captured).toEqual([]);
    expect(canvas.emit('contextmenu')).toBe(false);
    pointer('pointermove', 'mouse', 1, 950);
    // Клавиша отпущена на паузе — после включения она не «залипла», указатель там же, где был.
    key('keyup', 'ArrowLeft');
    input.setEnabled(true);
    expect(input.frame()).toEqual({ axis: 0, pointerX: 40, source: 'keyboard' });
    expect(canvas.emit('contextmenu')).toBe(true);
  });

  it('клавиша, зажатая при включении, сразу рулит', () => {
    mouseTo(400);
    input.setEnabled(false);
    key('keydown', 'KeyD');
    input.setEnabled(true);
    expect(input.frame()).toEqual({ axis: 1, pointerX: 40, source: 'keyboard' });
  });

  it('reset: клавиши и указатель сброшены; мышь спит, пока не сдвинется заметно', () => {
    key('keydown', 'ArrowLeft');
    pointer('pointerdown', 'touch', 1, 300);
    input.reset();
    expect(input.frame()).toEqual({ axis: 0, pointerX: null, source: 'none' });
    pointer('pointermove', 'touch', 1, 500);
    expect(input.frame().pointerX).toBeNull();
    // Старт забега: курсор лежит там, где нажали «Играть», — первое событие корабль не ведёт.
    mouse(120);
    mouse(120 + MOUSE_WAKE_PX - 1);
    expect(input.frame()).toEqual({ axis: 0, pointerX: null, source: 'none' });
    mouse(120 + MOUSE_WAKE_PX);
    expect(input.frame()).toEqual({ axis: 0, pointerX: 12.4, source: 'pointer' });
  });

  it('старт и рестарт забега усыпляют мышь, кто бы ни рулил до этого', () => {
    // Рулила мышь.
    mouseTo(300);
    input.reset();
    mouse(640);
    mouse(642);
    expect(input.frame()).toEqual({ axis: 0, pointerX: null, source: 'none' });
    // Рулила клавиатура; курсор за это время переехал.
    key('keydown', 'KeyA');
    key('keyup', 'KeyA');
    input.reset();
    mouse(200);
    mouse(203);
    expect(input.frame()).toEqual({ axis: 0, pointerX: null, source: 'none' });
    // Рулил палец.
    pointer('pointerdown', 'touch', 7, 900);
    pointer('pointerup', 'touch', 7, 900);
    input.reset();
    mouse(500);
    mouse(501);
    expect(input.frame()).toEqual({ axis: 0, pointerX: null, source: 'none' });
    mouse(560);
    expect(input.frame()).toEqual({ axis: 0, pointerX: 56, source: 'pointer' });
  });

  describe('после паузы мышь спит', () => {
    /** Пауза: холст под её экраном событий мыши не получает — курсор переезжает молча. */
    const pauseAndResume = () => {
      input.setEnabled(false);
      input.setEnabled(true);
    };

    it.each([1, 2, 3])('клавиатурный игрок: мышь уехала за паузу, дрожание на %i px корабль не ведёт', (nudge) => {
      mouseTo(400);
      key('keydown', 'ArrowRight');
      key('keyup', 'ArrowRight');
      const before = { ...input.frame() };
      expect(before).toEqual({ axis: 0, pointerX: 40, source: 'keyboard' });
      // Esc, курсор уезжает к «Продолжить» (x = 640), клик по кнопке — мимо холста.
      pauseAndResume();
      // Первое событие после паузы — уже у кнопки, в сотнях пикселей от прежней точки покоя.
      mouse(640);
      expect(input.frame()).toEqual(before);
      mouse(640 + nudge);
      mouse(640 - nudge);
      mouse(640);
      expect(input.frame()).toEqual(before);
    });

    it.each([1, 2, 3])('игрок с мышью: клик по «Продолжить» и дрожание на %i px корабль не ведут', (nudge) => {
      mouseTo(100);
      const before = { ...input.frame() };
      expect(before).toEqual({ axis: 0, pointerX: 10, source: 'pointer' });
      pauseAndResume();
      // Цель руления осталась там, где корабль был до паузы.
      expect(input.frame()).toEqual(before);
      mouse(640);
      mouse(640 + nudge);
      mouse(640 - nudge);
      expect(input.frame()).toEqual(before);
    });

    it('намеренное движение дальше порога возвращает управление мыши — у любого игрока', () => {
      mouseTo(100);
      pauseAndResume();
      mouse(640);
      mouse(640 - MOUSE_WAKE_PX + 1);
      expect(input.frame().pointerX).toBe(10);
      mouse(640 - MOUSE_WAKE_PX);
      expect(input.frame()).toEqual({ axis: 0, pointerX: 63.6, source: 'pointer' });
      // Проснувшаяся мышь ведёт каждым событием, без порога.
      mouse(637);
      expect(input.frame().pointerX).toBe(63.7);

      key('keydown', 'ArrowLeft');
      key('keyup', 'ArrowLeft');
      pauseAndResume();
      mouse(900);
      mouse(902);
      expect(input.frame()).toEqual({ axis: 0, pointerX: 63.7, source: 'keyboard' });
      mouse(910);
      expect(input.frame()).toEqual({ axis: 0, pointerX: 91, source: 'pointer' });
    });

    it('события мыши, пришедшие на паузе, точкой покоя не становятся', () => {
      mouseTo(400);
      key('keydown', 'ArrowRight');
      key('keyup', 'ArrowRight');
      input.setEnabled(false);
      // Уходящий экран паузы уже прозрачен для указателя: холст увидел часть пути курсора.
      mouse(500);
      mouse(600);
      input.setEnabled(true);
      mouse(641);
      mouse(643);
      expect(input.frame()).toEqual({ axis: 0, pointerX: 40, source: 'keyboard' });
    });

    it('клавиша после паузы не подменяет точку покоя старым положением мыши', () => {
      mouseTo(100);
      pauseAndResume();
      // Мышь рулила до паузы и с тех пор молчит: клавиатура берёт управление, mouseX устарел.
      key('keydown', 'ArrowRight');
      key('keyup', 'ArrowRight');
      mouse(640);
      mouse(641);
      expect(input.frame()).toEqual({ axis: 0, pointerX: 10, source: 'keyboard' });
    });

    it('автопауза по потере фокуса: то же самое, зажатая клавиша отпущена', () => {
      mouseTo(400);
      key('keydown', 'ArrowLeft');
      win.emit('blur');
      pauseAndResume();
      expect(input.frame()).toEqual({ axis: 0, pointerX: 40, source: 'keyboard' });
      mouse(1000);
      mouse(1002);
      expect(input.frame()).toEqual({ axis: 0, pointerX: 40, source: 'keyboard' });
    });

    it('клик мышью по полю будит её сразу', () => {
      mouseTo(100);
      pauseAndResume();
      pointer('pointerdown', 'mouse', 1, 700);
      expect(input.frame()).toEqual({ axis: 0, pointerX: 70, source: 'pointer' });
      mouse(701);
      expect(input.frame().pointerX).toBe(70.1);
    });

    it('палец и перо после паузы ведут как раньше — сразу, без порога', () => {
      pointer('pointerdown', 'touch', 5, 300);
      pointer('pointerup', 'touch', 5, 300);
      pauseAndResume();
      expect(input.frame()).toEqual({ axis: 0, pointerX: 30, source: 'pointer' });
      expect(pointer('pointerdown', 'touch', 6, 640)).toBe(true);
      expect(input.frame().pointerX).toBe(64);
      pointer('pointermove', 'touch', 6, 641);
      expect(input.frame().pointerX).toBe(64.1);
      pointer('pointerup', 'touch', 6, 641);
      pointer('pointerdown', 'pen', 9, 200);
      expect(input.frame().pointerX).toBe(20);
      pointer('pointermove', 'pen', 9, 202);
      expect(input.frame().pointerX).toBe(20.2);
      pointer('pointerup', 'pen', 9, 202);
      // Палец, оставшийся на экране с паузы, ведёт первым же движением.
      pointer('pointerdown', 'touch', 2, 500);
      input.setEnabled(false);
      pointer('pointermove', 'touch', 2, 520);
      input.setEnabled(true);
      pointer('pointermove', 'touch', 2, 521);
      expect(input.frame()).toEqual({ axis: 0, pointerX: 52.1, source: 'pointer' });
    });
  });

  it('нечисловой результат toRoadX игнорируется', () => {
    input.attach(canvas as unknown as HTMLElement, () => Number.NaN);
    mouseTo(300);
    pointer('pointerdown', 'touch', 3, 300);
    expect(input.frame()).toEqual({ axis: 0, pointerX: null, source: 'none' });
  });

  it('attach идемпотентен, новый toRoadX подхватывается; detach снимает всё', () => {
    const before = win.count() + canvas.count();
    expect(before).toBe(8);
    expect(canvas.style.touchAction).toBe('none');
    input.attach(canvas as unknown as HTMLElement, (x) => x / 5);
    expect(win.count() + canvas.count()).toBe(before);
    mouseTo(250);
    expect(input.frame().pointerX).toBe(50);

    // Другой холст — со старого всё снимается.
    const other = new FakeTarget();
    pointer('pointerdown', 'touch', 6, 100);
    input.attach(other as unknown as HTMLElement, toRoadX);
    expect(canvas.count()).toBe(0);
    expect(canvas.released).toEqual([6]);
    expect(canvas.style.touchAction).toBe('pan-y');
    expect(other.count()).toBe(5);
    expect(win.count()).toBe(3);

    input.detach();
    expect(win.count() + other.count()).toBe(0);
    expect(other.style.touchAction).toBe('pan-y');
    key('keydown', 'ArrowLeft');
    expect(input.frame()).toEqual({ axis: 0, pointerX: null, source: 'none' });
    input.detach();
  });
});
