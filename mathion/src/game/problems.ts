// Генератор примеров «Алхимического Горна».
// difficulty растёт с уровнем врага (в бою) или с числом верных ответов (в блице).

import type { Element, Problem, Rng } from '../types';
import { randInt, uid } from './utils';

const MINUS = '−';

/** Число со «типографским» минусом: −5. */
function n(value: number): string {
  return value < 0 ? `${MINUS}${Math.abs(value)}` : String(value);
}

function make(element: Element, kind: Problem['kind'], display: string, solution: string, answer: number, difficulty: number): Problem {
  return { id: uid(), element, kind, display, solution, answer, difficulty };
}

/** Магия Земли: сложение и вычитание, на высокой сложности — три операнда. */
function earth(d: number, rng: Rng): Problem {
  const hi = d < 8 ? 10 + d * 9 : 20 + d * 14;
  if (d >= 10 && rng() < 0.45) {
    const a = randInt(rng, Math.floor(hi / 3), hi);
    const b = randInt(rng, 5, Math.floor(hi / 2));
    const c = randInt(rng, 2, a + b - 1);
    const answer = a + b - c;
    return make('earth', 'mixed', `${a} + ${b} ${MINUS} ${c}`, `${a} + ${b} ${MINUS} ${c} = ${answer}`, answer, d);
  }
  if (rng() < 0.5) {
    const a = randInt(rng, 1 + Math.floor(d / 2), hi);
    const b = randInt(rng, 1 + Math.floor(d / 2), hi);
    return make('earth', 'add', `${a} + ${b}`, `${a} + ${b} = ${a + b}`, a + b, d);
  }
  const a = randInt(rng, Math.max(3, Math.floor(hi / 3)), hi);
  const b = randInt(rng, 1, a - 1);
  return make('earth', 'sub', `${a} ${MINUS} ${b}`, `${a} ${MINUS} ${b} = ${a - b}`, a - b, d);
}

/** Магия Огня: умножение. С 10-й сложности — двузначное на однозначное. */
function fire(d: number, rng: Rng): Problem {
  let a: number;
  let b: number;
  if (d >= 10 && rng() < 0.5) {
    a = randInt(rng, 11, Math.min(19 + d, 49));
    b = randInt(rng, 3, 9);
  } else {
    a = randInt(rng, 2, Math.min(4 + d, 20));
    b = randInt(rng, 2, Math.min(5 + Math.floor(d * 1.2), 25));
  }
  return make('fire', 'mul', `${a} × ${b}`, `${a} × ${b} = ${a * b}`, a * b, d);
}

/** Магия Воды: деление нацело. */
function water(d: number, rng: Rng): Problem {
  const divisor = randInt(rng, 2, Math.min(3 + d, 15));
  const quotient = randInt(rng, 2, Math.min(5 + d, 24));
  const dividend = divisor * quotient;
  return make('water', 'div', `${dividend} ÷ ${divisor}`, `${dividend} ÷ ${divisor} = ${quotient}`, quotient, d);
}

/** Высшая Магия Пустоты: линейные уравнения. С ростом сложности — отрицательные корни и новые формы. */
function voidMagic(d: number, rng: Rng): Problem {
  const a = randInt(rng, 2, Math.min(2 + Math.floor(d / 2), 12));
  const b = randInt(rng, 1, 5 + d * 2);
  let x: number;
  if (d < 5) {
    x = randInt(rng, 1, 9);
  } else if (d < 10) {
    x = randInt(rng, -5, 12);
  } else {
    x = randInt(rng, -15, 20);
  }
  if (x === 0) x = 1 + randInt(rng, 0, 4);

  const forms: number[] = [0, 1];
  if (d >= 6) forms.push(2);
  if (d >= 9) forms.push(3);
  const form = forms[randInt(rng, 0, forms.length - 1)] ?? 0;
  const ax = a === 1 ? 'x' : `${a}x`;

  if (form === 1) {
    const c = a * x - b;
    return make('void', 'eq', `${ax} ${MINUS} ${b} = ${n(c)}`, `${ax} ${MINUS} ${b} = ${n(c)} → x = ${n(x)}`, x, d);
  }
  if (form === 2) {
    const c = b - a * x;
    return make('void', 'eq', `${b} ${MINUS} ${ax} = ${n(c)}`, `${b} ${MINUS} ${ax} = ${n(c)} → x = ${n(x)}`, x, d);
  }
  if (form === 3) {
    // x / a + b = c, где x кратен a
    const q = x;
    const xv = q * a;
    const c = q + b;
    return make('void', 'eq', `x ÷ ${a} + ${b} = ${n(c)}`, `x ÷ ${a} + ${b} = ${n(c)} → x = ${n(xv)}`, xv, d);
  }
  const c = a * x + b;
  return make('void', 'eq', `${ax} + ${b} = ${n(c)}`, `${ax} + ${b} = ${n(c)} → x = ${n(x)}`, x, d);
}

const GENERATORS: Record<Element, (d: number, rng: Rng) => Problem> = {
  earth,
  fire,
  water,
  void: voidMagic,
};

export interface ProblemOptions {
  /** Только чётные ответы (босс «Близнецы Чётности»). */
  evenOnly?: boolean;
}

export function generateProblem(element: Element, difficulty: number, rng: Rng, options: ProblemOptions = {}): Problem {
  const d = Math.max(1, Math.round(difficulty));
  const generator = GENERATORS[element];
  let problem = generator(d, rng);
  if (options.evenOnly) {
    for (let attempt = 0; attempt < 60 && problem.answer % 2 !== 0; attempt += 1) {
      problem = generator(d, rng);
    }
    if (problem.answer % 2 !== 0) {
      // Страховка: удваиваем простой пример, чтобы ответ гарантированно стал чётным.
      const a = randInt(rng, 2, 20) * 2;
      const b = randInt(rng, 1, 10) * 2;
      problem = make(element, 'add', `${a} + ${b}`, `${a} + ${b} = ${a + b}`, a + b, d);
    }
  }
  return problem;
}

/** Разбирает ввод игрока. Возвращает число или null, если ввод не является целым числом. */
export function parseAnswer(input: string): number | null {
  const normalized = input.trim().replace(MINUS, '-');
  if (!/^-?\d{1,6}$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isSafeInteger(value) ? value : null;
}

/** Нормализует набор с клавиатуры/Numpad: цифры, один минус в начале, не длиннее 6 цифр. */
export function applyInputKey(current: string, key: string): string {
  if (key === 'clear') return '';
  if (key === 'back') return current.slice(0, -1);
  if (key === '-') return current.startsWith('-') ? current.slice(1) : `-${current}`;
  if (!/^\d$/.test(key)) return current;
  const digits = current.replace('-', '');
  if (digits.length >= 6) return current;
  if (digits === '0') return current.replace('0', key);
  return current + key;
}
