/**
 * Пальцы на экране. Чистая логика без DOM.
 *
 * Управляет последний опущенный палец. Когда его поднимают, управление
 * переходит к тому, что остался на экране, — туда, где он сейчас, поэтому
 * положение запоминается для каждого пальца, даже пока он не управляет.
 * Хранится экранный X (clientX), а не X на дороге: перевод может измениться
 * между событиями (поворот телефона).
 */
export class TouchStack {
  /** Пальцы на экране в порядке касания; последний — управляющий. */
  private readonly ids: number[] = [];
  private readonly xs = new Map<number, number>();

  get size(): number {
    return this.ids.length;
  }

  /** Палец опущен — он становится управляющим. */
  down(id: number, clientX: number): void {
    this.remove(id);
    this.ids.push(id);
    this.xs.set(id, clientX);
  }

  /** Палец сдвинулся. true — это управляющий палец. */
  move(id: number, clientX: number): boolean {
    if (!this.xs.has(id)) return false;
    this.xs.set(id, clientX);
    return this.ids[this.ids.length - 1] === id;
  }

  /**
   * Палец поднят (или касание отменено). Если он управлял и на экране остались
   * другие — возвращает clientX пальца, к которому перешло управление; иначе null.
   */
  up(id: number): number | null {
    const wasTop = this.ids[this.ids.length - 1] === id;
    if (!this.remove(id) || !wasTop || this.ids.length === 0) return null;
    return this.xs.get(this.ids[this.ids.length - 1]) ?? null;
  }

  /** Идентификаторы пальцев на экране. */
  active(): readonly number[] {
    return this.ids;
  }

  clear(): void {
    this.ids.length = 0;
    this.xs.clear();
  }

  private remove(id: number): boolean {
    const i = this.ids.indexOf(id);
    if (i < 0) return false;
    this.ids.splice(i, 1);
    this.xs.delete(id);
    return true;
  }
}
