import { motion } from 'framer-motion';
import { X, type LucideIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { IconButton } from './IconButton';

type Accent = 'pink' | 'cyan' | 'yellow' | 'theme';

const ACCENT: Record<Accent, { frame: string; title: string; corner: string }> = {
  pink: { frame: 'box-glow-pink', title: 'text-neon-pink text-glow-pink', corner: 'border-neon-pink' },
  cyan: { frame: 'box-glow-cyan', title: 'text-neon-cyan text-glow-cyan', corner: 'border-neon-cyan' },
  yellow: { frame: 'box-glow-yellow', title: 'text-neon-yellow text-glow-yellow', corner: 'border-neon-yellow' },
  theme: { frame: 'box-glow-theme', title: 'text-theme-a text-glow-theme', corner: 'border-theme-a' },
};

const WIDTH = { md: 'max-w-md', lg: 'max-w-2xl', xl: 'max-w-4xl' } as const;

export interface PanelProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  accent?: Accent;
  width?: keyof typeof WIDTH;
  /** Кнопка закрытия в заголовке (и Esc — его обрабатывает App). */
  onClose?: () => void;
  /** Нижняя строка панели (кнопки действий). */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Модальная неоновая панель: стеклянная подложка, светящаяся рамка, уголки,
 * заголовок шрифтом Orbitron и прокручиваемое тело. Появляется с масштабом и
 * расфокусом (Framer Motion) — кладите внутрь <Overlay>.
 */
export function Panel({
  title,
  subtitle,
  icon: Icon,
  accent = 'cyan',
  width = 'lg',
  onClose,
  footer,
  children,
  className = '',
}: PanelProps) {
  const titleId = useId();
  const a = ACCENT[accent];
  return (
    <motion.section
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      initial={{ opacity: 0, y: 28, scale: 0.95, filter: 'blur(8px)' }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
      exit={{ opacity: 0, y: 18, scale: 0.97, filter: 'blur(6px)' }}
      // Пружина с перелётом увела бы blur() в минус — фильтр и прозрачность идут отдельной плавной кривой.
      transition={{
        type: 'spring',
        stiffness: 260,
        damping: 26,
        filter: { type: 'tween', duration: 0.3, ease: 'easeOut' },
        opacity: { type: 'tween', duration: 0.25, ease: 'easeOut' },
      }}
      className={['glass relative flex max-h-full w-full flex-col rounded-[4px]', a.frame, WIDTH[width], className].join(' ')}
    >
      {/* Уголки-скобы. */}
      <span aria-hidden className={`pointer-events-none absolute -left-1 -top-1 h-4 w-4 border-l-2 border-t-2 ${a.corner}`} />
      <span aria-hidden className={`pointer-events-none absolute -right-1 -top-1 h-4 w-4 border-r-2 border-t-2 ${a.corner}`} />
      <span aria-hidden className={`pointer-events-none absolute -bottom-1 -left-1 h-4 w-4 border-b-2 border-l-2 ${a.corner}`} />
      <span aria-hidden className={`pointer-events-none absolute -bottom-1 -right-1 h-4 w-4 border-b-2 border-r-2 ${a.corner}`} />

      <header className="flex items-start gap-3 border-b border-white/10 px-4 py-3 sm:px-6 sm:py-4">
        {Icon && <Icon className={`mt-0.5 shrink-0 ${a.title}`} size={24} strokeWidth={2.25} aria-hidden />}
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className={`font-display text-lg font-bold uppercase tracking-widest sm:text-2xl ${a.title}`}>
            {title}
          </h2>
          {subtitle && <p className="mt-1 text-xs tracking-wide text-ink-dim sm:text-sm">{subtitle}</p>}
        </div>
        {onClose && <IconButton icon={X} label="Закрыть" size="sm" sound="back" onClick={onClose} />}
      </header>

      <div className="nv-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">{children}</div>

      {footer && <footer className="border-t border-white/10 px-4 py-3 sm:px-6">{footer}</footer>}
    </motion.section>
  );
}
