/**
 * Динамика корабля: один тик движения по x. Формулы — контракт (SPEC §4):
 * на формулу указателя опирается бот, на клавиатурную — ощущение управления.
 * Функции меняют Player на месте и ничего не выделяют в куче.
 */
import { GAME, WORLD } from './config';
import { clamp } from './math';
import { TICK_DT } from './timing';
import type { InputFrame, Player } from './types';

/** Пределы центра корабля по x. */
export const SHIP_MIN_X = GAME.player.edge;
export const SHIP_MAX_X = WORLD.roadW - GAME.player.edge;

/** Доля скорости, остающаяся после одного тика торможения. */
const FRICTION_KEEP = Math.exp(-GAME.player.friction * TICK_DT);
/** Доля пути, которую крен проходит к цели за тик. */
const BANK_BLEND = 1 - Math.exp(-GAME.player.bankRate * TICK_DT);
/** Ниже этой скорости корабль считается остановившимся. */
const REST_SPEED = 0.01;

/** Сдвинуть корабль на vx за тик; у стены он останавливается. Крен догоняет скорость. */
export function moveShip(p: Player): void {
  p.x += p.vx * TICK_DT;
  if (p.x < SHIP_MIN_X) {
    p.x = SHIP_MIN_X;
    p.vx = 0;
  } else if (p.x > SHIP_MAX_X) {
    p.x = SHIP_MAX_X;
    p.vx = 0;
  }
  // Выпуклая комбинация значений из [−1, 1] — крен не может выйти за пределы.
  p.bank += (clamp(p.vx / GAME.player.maxSpeed, -1, 1) - p.bank) * BANK_BLEND;
}

/** Управление игрока: указатель тянет корабль к себе, клавиатура разгоняет и тормозит. */
export function steerShip(p: Player, input: InputFrame): void {
  const g = GAME.player;
  const pointerX = input.pointerX;
  if (input.source === 'pointer' && pointerX !== null && Number.isFinite(pointerX)) {
    p.vx = clamp((pointerX - p.x) * g.pointerFollow, -g.pointerMaxSpeed, g.pointerMaxSpeed);
  } else {
    // Нет указателя или ввода вовсе — корабль ведёт себя как при отпущенных клавишах.
    const axis = input.source === 'keyboard' && Number.isFinite(input.axis) ? clamp(input.axis, -1, 1) : 0;
    if (axis !== 0) {
      p.vx += axis * g.accel * TICK_DT;
    } else {
      p.vx *= FRICTION_KEEP;
      if (Math.abs(p.vx) < REST_SPEED) p.vx = 0;
    }
    p.vx = clamp(p.vx, -g.maxSpeed, g.maxSpeed);
  }
  moveShip(p);
}

/** Корабль без управления (взрыв, конец забега): стоит на месте, крен выравнивается. */
export function restShip(p: Player): void {
  p.vx = 0;
  moveShip(p);
}
