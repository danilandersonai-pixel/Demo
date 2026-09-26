import { AnimatePresence, motion, useSpring, useTransform } from 'framer-motion';
import { X, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

export function Panel({
  code,
  title,
  icon: Icon,
  color = '#8f9bad',
  right,
  className = '',
  bodyClassName = 'p-3',
  children,
}: {
  code: string;
  title: string;
  icon?: LucideIcon;
  color?: string;
  right?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section className={`panel flex flex-col ${className}`}>
      <header className="panel-head">
        <span className="panel-code">{code}</span>
        {Icon && <Icon size={14} color={color} aria-hidden />}
        <h2 className="panel-title truncate">{title}</h2>
        {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
      </header>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function Meter({
  value,
  color,
  height = 6,
  marker,
  className = '',
  label,
}: {
  value: number;
  color: string;
  height?: number;
  /** Отметка на шкале 0…1 (например, 100% генерации). */
  marker?: number;
  className?: string;
  label?: string;
}) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <div
      className={`relative w-full overflow-hidden rounded-full border border-steel-700/70 bg-steel-950 ${className}`}
      style={{ height }}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      aria-label={label}
    >
      <motion.div
        className="h-full rounded-full"
        style={{ background: color, boxShadow: `0 0 10px ${color}` }}
        initial={false}
        animate={{ width: `${v * 100}%` }}
        transition={{ type: 'spring', stiffness: 140, damping: 22 }}
      />
      {marker !== undefined && (
        <div
          className="absolute top-0 bottom-0 w-px bg-steel-100/70"
          style={{ left: `${Math.max(0, Math.min(1, marker)) * 100}%` }}
        />
      )}
    </div>
  );
}

export function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const mv = useSpring(value, { stiffness: 90, damping: 20, mass: 0.6 });
  useEffect(() => {
    mv.set(value);
  }, [mv, value]);
  const text = useTransform(mv, (v) => format(v));
  return <motion.span>{text}</motion.span>;
}

export function Switch({
  id,
  checked,
  onChange,
  label,
  color = '#34d399',
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  color?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-steel-300 hover:text-steel-100"
    >
      <span
        className="relative inline-block h-3.5 w-7 rounded-full border transition-colors"
        style={{
          borderColor: checked ? color : '#3a4454',
          background: checked ? `${color}26` : '#0c0f14',
        }}
      >
        <motion.span
          className="absolute top-[1px] h-2.5 w-2.5 rounded-full"
          initial={false}
          animate={{ left: checked ? 14 : 2 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          style={{ background: checked ? color : '#4b5667', boxShadow: checked ? `0 0 6px ${color}` : 'none' }}
        />
      </span>
      {label}
    </button>
  );
}

export function Badge({ color, children, className = '' }: { color: string; children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-[3px] border px-1.5 py-[1px] font-mono text-[10px] font-semibold uppercase tracking-wider ${className}`}
      style={{ color, borderColor: `${color}66`, background: `${color}14` }}
    >
      {children}
    </span>
  );
}

export function Modal({
  open,
  onClose,
  code,
  title,
  icon: Icon,
  color = '#22d3ee',
  width = 'max-w-lg',
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  code: string;
  title: string;
  icon?: LucideIcon;
  color?: string;
  width?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="backdrop"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-3 backdrop-blur-[2px] sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className={`panel flex max-h-[min(92dvh,820px)] w-full ${width} flex-col outline-none`}
            initial={{ y: 28, scale: 0.97, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 16, scale: 0.98, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          >
            <header className="panel-head">
              <span className="panel-code">{code}</span>
              {Icon && <Icon size={16} color={color} aria-hidden />}
              <h2 id={titleId} className="panel-title truncate">
                {title}
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="ml-auto rounded p-1 text-steel-300 hover:bg-steel-800 hover:text-steel-100"
                aria-label="Закрыть"
              >
                <X size={16} />
              </button>
            </header>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
            {footer && <div className="border-t border-steel-750 p-3">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Маленькая линия-график с заливкой. */
export function Sparkline({
  values,
  color,
  height = 48,
  className = '',
  baseline,
}: {
  values: number[];
  color: string;
  height?: number;
  className?: string;
  /** Горизонтальная пунктирная отметка (например, базовая цена). */
  baseline?: number;
}) {
  const W = 300;
  const H = height;
  if (values.length < 2) {
    return (
      <div className={`grid place-items-center font-mono text-[10px] text-steel-500 ${className}`} style={{ height }}>
        нет данных
      </div>
    );
  }
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (baseline !== undefined) {
    min = Math.min(min, baseline);
    max = Math.max(max, baseline);
  }
  if (max - min < 1e-9) {
    max += 1;
    min = Math.max(0, min - 1);
  }
  const pad = 3;
  const x = (i: number) => (i / (values.length - 1)) * W;
  const y = (v: number) => pad + (1 - (v - min) / (max - min)) * (H - pad * 2);
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;
  const gid = `g${color.replace('#', '')}${H}`;
  const last = values[values.length - 1];
  return (
    <div className={`relative w-full ${className}`} style={{ height }} aria-hidden>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 block h-full w-full">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1="0"
            x2={W}
            y1={H * f}
            y2={H * f}
            stroke="#ffffff"
            strokeOpacity="0.05"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {baseline !== undefined && (
          <line
            x1="0"
            x2={W}
            y1={y(baseline)}
            y2={y(baseline)}
            stroke="#8f9bad"
            strokeOpacity="0.5"
            strokeDasharray="4 4"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      </svg>
      <span
        className="absolute right-0 h-1.5 w-1.5 -translate-y-1/2 translate-x-1/2 rounded-full"
        style={{ top: `${(y(last) / H) * 100}%`, background: color, boxShadow: `0 0 8px ${color}` }}
      />
    </div>
  );
}
