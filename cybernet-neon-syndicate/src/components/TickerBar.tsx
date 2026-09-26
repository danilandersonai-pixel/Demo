import { useReducedMotion } from 'framer-motion';
import { SquareTerminal } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useGameContext } from './GameContext.tsx';
import { TONE_TEXT } from './ui/accent.ts';
import { cn } from './ui/cn.ts';

const SPEED_PX = 42; // пикселей в секунду
const COPIES = 3;
const ITEMS = 10;

/**
 * Бегущая строка Синдикат-Лога, закреплённая у нижнего края экрана.
 * Смещение хранится в пикселях и двигается через requestAnimationFrame: когда в начале списка
 * выпадает старая запись, смещение уменьшается на её ширину — текст не прыгает.
 */
export function TickerBar({ onOpenLog, inert }: { onOpenLog: () => void; inert?: boolean }) {
  const { state } = useGameContext();
  const reduce = useReducedMotion();
  // Без анимации строка стоит на месте — показываем свежие записи первыми, чтобы они были видны.
  const items = reduce ? state.log.slice(-ITEMS).reverse() : state.log.slice(-ITEMS);
  const track = useRef<HTMLDivElement>(null);
  const firstCopy = useRef<HTMLDivElement>(null);
  const offset = useRef(0);
  const widths = useRef(new Map<number, number>());
  const prevIds = useRef<number[]>([]);
  const hovered = useRef(false);

  useLayoutEffect(() => {
    const ids = items.map((item) => item.id);
    if (reduce) {
      offset.current = 0;
      prevIds.current = ids;
      widths.current.clear();
      if (track.current) track.current.style.transform = '';
      return;
    }
    const dropped = prevIds.current.filter((id) => !ids.includes(id));
    for (const id of dropped) {
      offset.current -= widths.current.get(id) ?? 0;
      widths.current.delete(id);
    }
    firstCopy.current?.querySelectorAll<HTMLElement>('[data-id]').forEach((node) => {
      widths.current.set(Number(node.dataset.id), node.getBoundingClientRect().width);
    });
    prevIds.current = ids;
    const width = firstCopy.current?.offsetWidth ?? 0;
    if (width > 0) offset.current = ((offset.current % width) + width) % width;
    if (track.current) track.current.style.transform = `translate3d(${-offset.current}px,0,0)`;
  });

  useEffect(() => {
    if (reduce) return undefined;
    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const width = firstCopy.current?.offsetWidth ?? 0;
      if (!hovered.current && width > 0) {
        offset.current += SPEED_PX * dt;
        if (offset.current >= width) offset.current -= width;
        if (track.current) track.current.style.transform = `translate3d(${-offset.current}px,0,0)`;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [reduce]);

  return (
    <div className="ticker-bar fixed inset-x-0 bottom-0 z-30 border-t border-line bg-void/90 backdrop-blur-xl" inert={inert}>
      <div className="flex h-9 items-stretch">
        <button
          type="button"
          onClick={onOpenLog}
          className="flex shrink-0 items-center gap-2 border-r border-line bg-data/[0.06] px-3 font-mono text-[10px] font-semibold tracking-[0.2em] text-data transition-colors hover:bg-data/15"
          aria-label="Открыть Синдикат-Лог"
        >
          <SquareTerminal className="size-3.5" aria-hidden />
          <span className="hidden sm:inline">SYNDICATE-LOG</span>
        </button>
        <div
          className="relative min-w-0 flex-1 overflow-hidden"
          onMouseEnter={() => {
            hovered.current = true;
          }}
          onMouseLeave={() => {
            hovered.current = false;
          }}
          aria-hidden
        >
          <div ref={track} className={cn('flex h-full w-max items-center whitespace-nowrap font-mono text-[11px]', reduce && 'flex-wrap')}>
            {Array.from({ length: reduce ? 1 : COPIES }, (_, copy) => (
              <div key={copy} ref={copy === 0 ? firstCopy : undefined} className="flex">
                {items.map((entry) => (
                  <span key={`${copy}-${entry.id}`} data-id={entry.id} className="px-4">
                    <span className="text-dim">[День {entry.day}]:</span>{' '}
                    <span className={TONE_TEXT[entry.tone]}>{entry.text}</span>
                    <span className="pl-8 text-data/40">◆</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
          <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-void to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-void to-transparent" />
        </div>
      </div>
    </div>
  );
}
