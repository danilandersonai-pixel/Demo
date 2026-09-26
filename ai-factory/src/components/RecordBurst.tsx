import { AnimatePresence, motion } from 'framer-motion';
import { Crown, Trophy } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { money, pct } from '../game/format';
import type { Celebration } from '../game/records';
import { AnimatedNumber } from '../ui/primitives';

const COLORS = ['#34d399', '#22d3ee', '#a855f7', '#f472b6', '#facc15', '#60a5fa'];

function particles(seed: number) {
  // Псевдослучайный, но стабильный для одного салюта разлёт частиц.
  let x = (seed * 9301 + 49297) % 233280;
  const rnd = () => {
    x = (x * 9301 + 49297) % 233280;
    return x / 233280;
  };
  return Array.from({ length: 34 }, (_, i) => {
    const angle = rnd() * Math.PI * 2;
    const dist = 140 + rnd() * 260;
    return {
      i,
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist - 40,
      rot: (rnd() - 0.5) * 540,
      size: 5 + rnd() * 7,
      color: COLORS[i % COLORS.length],
      delay: rnd() * 0.12,
    };
  });
}

export function RecordBurst({ celebration, onDone }: { celebration: Celebration | null; onDone: () => void }) {
  useEffect(() => {
    if (!celebration) return;
    const t = window.setTimeout(onDone, 4800);
    return () => window.clearTimeout(t);
  }, [celebration, onDone]);

  const parts = useMemo(() => (celebration ? particles(celebration.id * 7 + 3) : []), [celebration]);
  const income = celebration?.kind === 'income';
  const color = income ? '#34d399' : '#22d3ee';
  const Icon = income ? Trophy : Crown;
  const gain = income && celebration && celebration.prev > 0 ? celebration.value / celebration.prev - 1 : null;

  return (
    <AnimatePresence>
      {celebration && (
        <motion.div
          key={celebration.id}
          className="pointer-events-none fixed inset-0 z-[65] grid place-items-center overflow-hidden"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.35 } }}
        >
          <motion.div
            className="absolute inset-0"
            style={{ background: `radial-gradient(circle at 50% 45%, ${color}55, transparent 60%)` }}
            initial={{ opacity: 0.95 }}
            animate={{ opacity: 0.25 }}
            transition={{ duration: 1.2 }}
          />
          <motion.div
            className="absolute h-[150vmax] w-[150vmax]"
            style={{
              background: `repeating-conic-gradient(from 0deg, ${color}1f 0deg 5deg, transparent 5deg 15deg)`,
              maskImage: 'radial-gradient(circle, black 0%, transparent 42%)',
              WebkitMaskImage: 'radial-gradient(circle, black 0%, transparent 42%)',
            }}
            initial={{ rotate: 0, scale: 0.6, opacity: 0 }}
            animate={{ rotate: 55, scale: 1, opacity: 1 }}
            transition={{ duration: 4.8, ease: 'linear' }}
          />
          {parts.map((p) => (
            <motion.span
              key={p.i}
              className="absolute rounded-[2px]"
              style={{ width: p.size, height: p.size * 0.6, background: p.color, boxShadow: `0 0 8px ${p.color}` }}
              initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
              animate={{ x: p.dx, y: [0, p.dy, p.dy + 120], opacity: [1, 1, 0], rotate: p.rot }}
              transition={{ duration: 2.2, delay: p.delay, ease: 'easeOut' }}
            />
          ))}
          <motion.button
            type="button"
            onClick={onDone}
            className="panel pointer-events-auto relative mx-4 max-w-md px-8 py-6 text-center"
            style={{ borderColor: `${color}aa`, boxShadow: `0 0 60px ${color}55, 0 20px 60px rgba(0,0,0,.6)` }}
            initial={{ scale: 0.3, y: 60, opacity: 0, rotate: -4 }}
            animate={{ scale: 1, y: 0, opacity: 1, rotate: 0 }}
            exit={{ scale: 0.85, y: -30, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 15 }}
            aria-label="Закрыть уведомление о рекорде"
          >
            <motion.div
              className="mx-auto grid h-16 w-16 place-items-center rounded-full border-2"
              style={{ borderColor: color, background: `${color}22`, boxShadow: `0 0 30px ${color}88` }}
              initial={{ scale: 0, rotate: -120 }}
              animate={{ scale: [0, 1.25, 1], rotate: 0 }}
              transition={{ delay: 0.12, duration: 0.7 }}
            >
              <Icon size={34} color={color} />
            </motion.div>
            <motion.div
              className="mt-3 font-display text-[13px] uppercase tracking-[0.35em]"
              style={{ color }}
              initial={{ letterSpacing: '0.9em', opacity: 0 }}
              animate={{ letterSpacing: '0.35em', opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.6 }}
            >
              {income ? 'Новый рекорд дохода' : 'Рубеж построек'}
            </motion.div>
            <div className="num mt-1 text-4xl font-bold text-steel-100" style={{ textShadow: `0 0 24px ${color}` }}>
              {income ? (
                <>
                  <AnimatedNumber value={celebration.value} format={money} />
                  /с
                </>
              ) : (
                `${celebration.value} узлов`
              )}
            </div>
            <div className="mt-2 text-[13px] text-steel-300">
              {income
                ? gain !== null
                  ? `+${pct(gain)} к прошлому рекорду (${money(celebration.prev)}/с)`
                  : 'Первый рекорд пассивного дохода записан'
                : 'Столько автоматических узлов вы построили за всё время'}
            </div>
            <div className="mt-3 font-mono text-[10px] uppercase tracking-widest text-steel-500">
              сохранено в рекорды · нажмите, чтобы закрыть
            </div>
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
