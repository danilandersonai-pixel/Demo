import { AnimatePresence, motion, useAnimate } from 'framer-motion';
import { Gem } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatNumber, plural } from '../ui/format';
import { AnimatedNumber } from './AnimatedNumber';

interface Delta {
  id: number;
  amount: number;
}

export interface WalletBadgeProps {
  value: number;
  label?: string;
  className?: string;
}

/**
 * Кошелёк кристаллов: число докручивается, рамка вспыхивает, а изменение
 * всплывает над плашкой («−300» розовым при трате, «+37» бирюзой при доходе).
 */
export function WalletBadge({ value, label = 'Кошелёк', className = '' }: WalletBadgeProps) {
  const [scope, animateScope] = useAnimate<HTMLDivElement>();
  const prev = useRef(value);
  const nextId = useRef(1);
  const [deltas, setDeltas] = useState<Delta[]>([]);
  // Таймеры снятия всплывашек живут дольше одного изменения — чистим только при размонтировании.
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((t) => clearTimeout(t));
      pending.clear();
    };
  }, []);

  useEffect(() => {
    const diff = value - prev.current;
    prev.current = value;
    if (diff === 0) return;
    const id = nextId.current++;
    setDeltas((list) => [...list.slice(-2), { id, amount: diff }]);
    const tone = diff < 0 ? 'rgba(255,43,214,0.95)' : 'rgba(34,240,255,0.95)';
    animateScope(
      scope.current,
      {
        scale: [1, 1.08, 1],
        boxShadow: [`0 0 0 1px ${tone}, 0 0 26px ${tone}`, '0 0 0 1px rgba(34,240,255,0.3), 0 0 0px rgba(0,0,0,0)'],
      },
      { duration: 0.55, ease: 'easeOut' },
    );
    const t = setTimeout(() => {
      timers.current.delete(t);
      setDeltas((list) => list.filter((d) => d.id !== id));
    }, 1100);
    timers.current.add(t);
  }, [value, animateScope, scope]);

  return (
    <div
      ref={scope}
      className={[
        'relative inline-flex items-center gap-2 rounded-[3px] border border-neon-cyan/30 bg-void/70 px-3 py-1.5',
        className,
      ].join(' ')}
    >
      <span className="text-[9px] font-bold uppercase tracking-[0.25em] text-ink-faint sm:text-[10px]">{label}</span>
      <span className="inline-flex items-center gap-1.5 font-mono text-base font-bold text-neon-cyan text-glow-cyan sm:text-lg">
        <Gem size={17} strokeWidth={2.25} aria-hidden />
        <AnimatedNumber value={value} className="nvm-digits" />
      </span>
      <span className="sr-only" aria-live="polite">
        {`${formatNumber(value)} ${plural(value, ['кристалл', 'кристалла', 'кристаллов'])}`}
      </span>
      <AnimatePresence>
        {deltas.map((d) => (
          <motion.span
            key={d.id}
            aria-hidden
            initial={{ opacity: 0, y: 4, scale: 0.8 }}
            animate={{ opacity: 1, y: -22, scale: 1 }}
            exit={{ opacity: 0, y: -34 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className={[
              'nvm-digits pointer-events-none absolute right-2 top-0 font-mono text-sm font-bold',
              d.amount < 0 ? 'text-neon-pink text-glow-pink' : 'text-neon-cyan text-glow-cyan',
            ].join(' ')}
          >
            {d.amount < 0 ? '−' : '+'}
            {formatNumber(Math.abs(d.amount))}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}
