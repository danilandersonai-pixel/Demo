import { afterEach, describe, expect, it, vi } from 'vitest';
import { freezeAnimations, type AnimatedRoot } from './freeze';

/** Минимальная анимация Web Animations: состояние и счётчики вызовов. */
class FakeAnimation {
  playState: AnimationPlayState;
  paused = 0;
  played = 0;

  constructor(state: AnimationPlayState) {
    this.playState = state;
  }

  pause(): void {
    this.paused++;
    this.playState = 'paused';
  }

  play(): void {
    this.played++;
    this.playState = 'running';
  }

  cancel(): void {
    this.playState = 'idle';
  }

  finish(): void {
    this.playState = 'finished';
  }
}

/** В Node класса CSSAnimation нет — тест ставит свой, как в браузере. */
class FakeCssAnimation extends FakeAnimation {}

function rootOf(list: FakeAnimation[]): AnimatedRoot & { asked: (GetAnimationsOptions | undefined)[] } {
  const asked: (GetAnimationsOptions | undefined)[] = [];
  return {
    asked,
    getAnimations(options) {
      asked.push(options);
      return list as unknown as Animation[];
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('freezeAnimations — HUD под паузой', () => {
  it('ставит на паузу идущие анимации всего поддерева и продолжает их после паузы', () => {
    const pulse = new FakeAnimation('running');
    const fade = new FakeAnimation('running');
    const root = rootOf([pulse, fade]);

    const resume = freezeAnimations(root);
    expect(root.asked).toEqual([{ subtree: true }]);
    expect([pulse.playState, fade.playState]).toEqual(['paused', 'paused']);

    resume();
    expect([pulse.playState, fade.playState]).toEqual(['running', 'running']);
    expect([pulse.played, fade.played]).toEqual([1, 1]);
  });

  it('не трогает то, что не идёт: завершённые, отменённые и уже стоящие анимации', () => {
    const finished = new FakeAnimation('finished');
    const idle = new FakeAnimation('idle');
    const paused = new FakeAnimation('paused');

    const resume = freezeAnimations(rootOf([finished, idle, paused]));
    resume();

    for (const a of [finished, idle, paused]) expect([a.paused, a.played]).toEqual([0, 0]);
    // Чужая пауза остаётся чужой: её не снимает наше «продолжить».
    expect(paused.playState).toBe('paused');
  });

  it('CSS-анимации оставляет правилу [data-frozen]: пауза из скрипта пережила бы его снятие', () => {
    vi.stubGlobal('CSSAnimation', FakeCssAnimation);
    const sweep = new FakeCssAnimation('running');
    const pulse = new FakeAnimation('running');

    const resume = freezeAnimations(rootOf([sweep, pulse]));
    expect(sweep.paused).toBe(0);
    expect(pulse.paused).toBe(1);

    resume();
    expect(sweep.played).toBe(0);
    expect(pulse.played).toBe(1);
  });

  it('после паузы не оживляет анимации, которые за это время сняли или завершили', () => {
    const cancelled = new FakeAnimation('running');
    const finished = new FakeAnimation('running');
    const alive = new FakeAnimation('running');

    const resume = freezeAnimations(rootOf([cancelled, finished, alive]));
    // Framer заменил анимацию новой, узел размонтирован и т. п.
    cancelled.cancel();
    finished.finish();
    resume();

    expect([cancelled.played, finished.played, alive.played]).toEqual([0, 0, 1]);
    expect([cancelled.playState, finished.playState]).toEqual(['idle', 'finished']);
  });

  it('«продолжить» срабатывает один раз (эффект React может вызвать очистку повторно)', () => {
    const pulse = new FakeAnimation('running');
    const resume = freezeAnimations(rootOf([pulse]));

    resume();
    pulse.pause();
    resume();

    expect(pulse.played).toBe(1);
    expect(pulse.playState).toBe('paused');
  });
});

/**
 * Текст hud.css без комментариев. Vitest подменяет импорт CSS пустой строкой (и с ?raw),
 * а типов Node в проекте нет — файл читается модулем node:fs, подключённым по имени.
 */
async function readHudCss(): Promise<string> {
  const builtin = 'node:fs';
  const fs: { readFileSync(path: URL, encoding: 'utf8'): string } = await import(/* @vite-ignore */ builtin);
  return fs.readFileSync(new URL('./hud.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Правила верхнего уровня и внутри @media / @container: [селектор, тело]. */
function rules(css: string): [string, string][] {
  const out: [string, string][] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    if (!selector.startsWith('@') && !/^(\d+%|from|to)(\s*,\s*(\d+%|from|to))*$/.test(selector)) out.push([selector, m[2]]);
  }
  return out;
}

describe('hud.css — заморозка под паузой', async () => {
  const all = rules(await readHudCss());
  const freezing = all.filter(([, body]) => /animation-play-state/.test(body));

  it('одно правило ставит на паузу анимации всего замороженного HUD, с псевдоэлементами', () => {
    expect(freezing).toHaveLength(1);
    const selectors = freezing[0][0].split(',').map((s) => s.trim());
    expect(selectors.sort()).toEqual(['[data-frozen]', '[data-frozen] *', '[data-frozen] *::after', '[data-frozen] *::before']);
  });

  it('пауза объявлена с !important: шорткат animation в более специфичных правилах её не снимает', () => {
    expect(freezing[0][1]).toMatch(/animation-play-state:\s*paused\s*!important/);
    // Правила, которые запускают анимации, сами !important не используют — иначе порядок решал бы снова.
    const starters = all.filter(([, body]) => /(^|[;\s])animation(-name)?\s*:/.test(body));
    expect(starters.length).toBeGreaterThan(5);
    for (const [selector, body] of starters) {
      expect(body, selector).not.toMatch(/animation[^;]*!important/);
    }
    // Дефект perf-2: эти правила специфичнее обычного «[data-frozen] .класс» — пауза обязана их переживать.
    const selectors = starters.map(([selector]) => selector.replace(/\s+/g, ' '));
    expect(selectors).toContain(".nvh-combo[data-tone='od'] .nvh-combo-cell");
    expect(selectors).toContain('.nvh-level-bar[data-drop] .nvh-level-fill');
  });
});
