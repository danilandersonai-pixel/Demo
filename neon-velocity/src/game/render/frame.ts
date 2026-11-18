/**
 * Параметры текущего кадра, общие для всех художников мира. Один объект
 * на весь срок жизни рендера — в кадре только перезаписываются поля.
 */
export interface FrameInfo {
  /** Видимые границы мира с запасом (мировые единицы): всё, что за ними, не рисуется. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Точка схода перспективы в мировых координатах — туда смотрит «задняя грань» кубов. */
  vanishX: number;
  vanishY: number;
  /** Время анимаций, сек: замирает на паузе, замедляется в слоу-мо. */
  time: number;
  /** Импульс доли 1 → 0: удар в начале доли, затем спад. */
  beat: number;
  /** Во сколько раз реальная высота мира больше эталонной (скорости падения). */
  heightFactor: number;
}

export function createFrameInfo(): FrameInfo {
  return { left: 0, right: 0, top: 0, bottom: 0, vanishX: 0, vanishY: 0, time: 0, beat: 0, heightFactor: 1 };
}
