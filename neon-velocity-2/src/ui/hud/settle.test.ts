import { describe, expect, it } from 'vitest';
import { GAME_OVER_COUNT, GAME_OVER_SETTLE_MS } from './constants';

/**
 * Экран Game Over размывает фон через GAME_OVER_SETTLE_MS — когда на нём всё замерло.
 * Размытие (backdrop-filter) пересчитывается на весь экран при любом изменении на нём,
 * поэтому всё, что движется на Game Over и под ним, обязано кончиться раньше.
 *
 * Vitest подменяет импорт CSS пустой строкой, а типов Node в проекте нет — исходники
 * читаются модулем node:fs, подключённым по имени.
 */
async function readSource(path: string): Promise<string> {
  const builtin = 'node:fs';
  const fs: { readFileSync(path: URL, encoding: 'utf8'): string } = await import(/* @vite-ignore */ builtin);
  return fs.readFileSync(new URL(path, import.meta.url), 'utf8');
}

/** Запятые верхнего уровня: внутри steps(1, end) и cubic-bezier(…) список не режется. */
function splitTopLevel(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(list.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(list.slice(from));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Когда кончается одна анимация из шортката animation, мс: задержка + длительность × повторы. */
function animationEndMs(animation: string): number {
  const tokens = animation.replace(/\([^)]*\)/g, '').split(/\s+/);
  const times: number[] = [];
  let count = 1;
  for (const token of tokens) {
    const time = /^(\d*\.?\d+)(ms|s)$/.exec(token);
    if (time) times.push(Number(time[1]) * (time[2] === 's' ? 1000 : 1));
    else if (token === 'infinite') count = Number.POSITIVE_INFINITY;
    else if (/^\d*\.?\d+$/.test(token)) count = Number(token);
  }
  const [duration = 0, delay = 0] = times;
  return delay + duration * count;
}

/** Анимации правил, чей селектор относится к экрану Game Over: [селектор, анимация, конец в мс]. */
function gameOverAnimations(css: string): [string, string, number][] {
  const out: [string, string, number][] = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    if (!/\.nvh-(over|glitch|sign)/.test(selector)) continue;
    const declared = /(?:^|[;\s])animation\s*:([^;]+)/.exec(m[2]);
    if (!declared) continue;
    for (const animation of splitTopLevel(declared[1])) out.push([selector, animation, animationEndMs(animation)]);
  }
  return out;
}

describe('разбор шортката animation', () => {
  it('считает конец анимации с задержкой и повторами', () => {
    expect(animationEndMs('nvh-glitch-a 1.4s steps(1, end) 1')).toBe(1400);
    expect(animationEndMs('nvh-hum 1.2s linear 0.3s 1')).toBe(1500);
    expect(animationEndMs('nvh-glitch-b 2.2s steps(1, end) 2')).toBe(4400);
    expect(animationEndMs('nvh-ignite 800ms linear 1 both')).toBe(800);
    expect(animationEndMs('nvh-od-sweep 1.6s linear infinite')).toBe(Number.POSITIVE_INFINITY);
  });

  it('делит список анимаций по запятым верхнего уровня', () => {
    expect(splitTopLevel('a 1s steps(1, end) 1, b 2s cubic-bezier(0.1, 1, 0.3, 1) 0.5s')).toEqual(['a 1s steps(1, end) 1', 'b 2s cubic-bezier(0.1, 1, 0.3, 1) 0.5s']);
  });
});

describe('Game Over — размытие приходит, когда экран замер', async () => {
  const animations = gameOverAnimations(await readSource('./hud.css'));
  const host = await readSource('../GameHost.tsx');

  it('CSS-анимации экрана (глитч, вывеска рекорда) конечны и кончаются до размытия', () => {
    const names = animations.map(([, animation]) => animation.split(/\s+/)[0]);
    expect(names).toEqual(expect.arrayContaining(['nvh-glitch-a', 'nvh-glitch-b', 'nvh-ignite', 'nvh-hum']));
    for (const [selector, animation, end] of animations) {
      expect(end, `${selector} { animation: ${animation} }`).toBeLessThanOrEqual(GAME_OVER_SETTLE_MS);
    }
  });

  it('счёт набирается до размытия', () => {
    expect((GAME_OVER_COUNT.delay + GAME_OVER_COUNT.duration) * 1000).toBeLessThanOrEqual(GAME_OVER_SETTLE_MS);
  });

  it('холст под экраном останавливается до размытия', () => {
    const live = /const OVER_LIVE = (\d*\.?\d+);/.exec(host);
    expect(live, 'GameHost.tsx: const OVER_LIVE').not.toBeNull();
    expect(Number(live?.[1]) * 1000).toBeLessThan(GAME_OVER_SETTLE_MS);
  });
});
