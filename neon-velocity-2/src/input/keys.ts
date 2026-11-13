/**
 * Клавиши руления: ←/→ и A/D по физическому положению (e.code), поэтому
 * раскладка клавиатуры не важна. Чистая логика без DOM.
 *
 * Зажатые клавиши хранятся в порядке нажатия: рулит последняя нажатая, а когда
 * её отпускают, управление возвращается к той, что всё ещё зажата.
 */

const STEER = new Map<string, -1 | 1>([
  ['ArrowLeft', -1],
  ['KeyA', -1],
  ['ArrowRight', 1],
  ['KeyD', 1],
]);

/** Направление клавиши: −1 влево, 1 вправо, 0 — клавиша не рулит. */
export function steerDirection(code: string): -1 | 0 | 1 {
  return STEER.get(code) ?? 0;
}

export class SteerKeys {
  /** Зажатые клавиши руления в порядке нажатия. */
  private readonly held: string[] = [];

  /**
   * Клавиша нажата. true — она только что зажата (автоповтор уже зажатой
   * клавиши порядок не меняет и новым нажатием не считается).
   */
  press(code: string): boolean {
    if (steerDirection(code) === 0 || this.held.includes(code)) return false;
    this.held.push(code);
    return true;
  }

  release(code: string): void {
    const i = this.held.indexOf(code);
    if (i >= 0) this.held.splice(i, 1);
  }

  clear(): void {
    this.held.length = 0;
  }

  /** Ось руления: направление последней нажатой из зажатых клавиш, 0 — ничего не зажато. */
  get axis(): number {
    return this.held.length > 0 ? steerDirection(this.held[this.held.length - 1]) : 0;
  }
}
