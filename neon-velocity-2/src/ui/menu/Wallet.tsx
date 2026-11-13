import { motion, useAnimate } from 'framer-motion';
import { Gem } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatNumber, plural } from '../kit/format';
import { AnimatedNumber } from './AnimatedNumber';
import { CRYSTAL_FORMS } from './shared';

interface Delta {
  id: number;
  amount: number;
}

export interface WalletProps {
  value: number;
  className?: string;
}

/**
 * Кошелёк магазина: число докручивается к новому значению, плашка «вздрагивает»,
 * а рядом всплывает потраченная или полученная сумма. Скринридеру итог
 * сообщает вежливая live-область — промежуточные кадры прокрутки он не слышит.
 */
export function Wallet({ value, className = '' }: WalletProps) {
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const previous = useRef(value);
  const [delta, setDelta] = useState<Delta | null>(null);

  useEffect(() => {
    const amount = value - previous.current;
    if (amount === 0) return;
    previous.current = value;
    setDelta((d) => ({ id: (d?.id ?? 0) + 1, amount }));
    void animate(scope.current, { scale: [1, 1.12, 1] }, { duration: 0.42, ease: 'easeOut' });
  }, [value, animate, scope]);

  return (
    <div
      ref={scope}
      className={[
        'relative flex h-10 shrink-0 items-center gap-2 rounded-[3px] border border-neon-cyan/40 bg-void/70 px-3',
        'shadow-[0_0_14px_rgba(34,240,255,0.14),inset_0_0_12px_rgba(34,240,255,0.08)]',
        className,
      ].join(' ')}
    >
      <span className="text-[9px] font-bold uppercase tracking-[0.28em] text-neon-cyan/70">Кошелёк</span>
      <span className="flex items-center gap-1.5 font-mono text-base font-extrabold tracking-wider text-neon-cyan text-glow-cyan">
        <Gem size={15} strokeWidth={2.4} className="shrink-0" aria-hidden />
        <AnimatedNumber value={value} className="nvm-digits" />
      </span>
      <span role="status" className="sr-only">
        {`В кошельке ${formatNumber(value)} ${plural(value, CRYSTAL_FORMS)}`}
      </span>
      {delta && (
        <motion.span
          key={delta.id}
          aria-hidden
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: [0, 1, 1, 0], y: [4, -4, -12, -22] }}
          transition={{ duration: 1.25, ease: 'easeOut', times: [0, 0.15, 0.6, 1] }}
          className={[
            'nvm-digits pointer-events-none absolute -top-1 right-2 whitespace-nowrap text-xs font-extrabold',
            delta.amount < 0 ? 'text-neon-red text-glow-red' : 'text-neon-green',
          ].join(' ')}
        >
          {delta.amount < 0 ? '−' : '+'}
          {formatNumber(Math.abs(delta.amount))}
        </motion.span>
      )}
    </div>
  );
}
