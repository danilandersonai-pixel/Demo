import { motion, useIsPresent } from 'framer-motion';
import { useEffect, useState, type ReactNode } from 'react';

export interface OverlayProps {
  children: ReactNode;
  /** Клик по фону вне содержимого. */
  onBackdropClick?: () => void;
  /**
   * Размытие заднего плана (backdrop-blur). Без пропа подложка только затемняет:
   * панели меню лежат над живой демо-сценой, и полноэкранный backdrop-filter
   * пересчитывался бы там каждый кадр. Пауза и Game Over размывают фон — под
   * ними холст заморожен или замирает через долю секунды (см. GameHost). Уходящая
   * подложка размытие снимает сразу: под ней уже живой холст нового забега.
   */
  blur?: 'sm' | 'md' | 'lg';
  /**
   * Через сколько миллисекунд после появления экран размывает фон; до того подложка
   * только затемняет. Размытие пересчитывается на весь экран при любом изменении на
   * нём — под подложкой, внутри неё или над ней. Экран, который въезжает дольше доли
   * секунды или лежит над ещё живым холстом (Game Over), включает размытие, когда всё
   * замерло: оно приходит коротким «уводом в расфокус» и дальше не пересчитывается.
   */
  blurDelayMs?: number;
  /** Слой: 30 — экраны (пауза, game over, меню), 40 — панели поверх меню. */
  layer?: 30 | 40;
  className?: string;
  /** Подпись для скринридеров. */
  label?: string;
  /**
   * Слой перекрыт модальной панелью (например, «Рекорды» поверх Game Over):
   * inert убирает его целиком из дерева доступности, порядка Tab и из-под
   * указателя — открытым остаётся ровно один диалог.
   */
  inert?: boolean;
}

/**
 * Поля вокруг содержимого — не меньше безопасной зоны со всех сторон: телефон
 * боком (viewport-fit=cover) заводит раскладку под «чёлку» и скругления слева и
 * справа. На низком экране вертикальные поля тоньше — высота нужнее карточке.
 */
const OUTER_PADDING = [
  'pt-[max(1.5rem,env(safe-area-inset-top,0px))] pb-[max(1.5rem,env(safe-area-inset-bottom,0px))]',
  'pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))]',
  '[@media(max-height:560px)]:pt-[max(0.5rem,env(safe-area-inset-top,0px))]',
  '[@media(max-height:560px)]:pb-[max(0.5rem,env(safe-area-inset-bottom,0px))]',
].join(' ');

const BLUR = { sm: 'backdrop-blur-sm', md: 'backdrop-blur-md', lg: 'backdrop-blur-lg' } as const;

/** Отложенное размытие приходит плавно; при «меньше движения» — сразу. Уходящая подложка перехода не имеет. */
const BLUR_IN = 'transition-[backdrop-filter,-webkit-backdrop-filter] duration-200 ease-out motion-reduce:transition-none';

/**
 * Полноэкранная затемняющая подложка с плавным появлением и, по запросу,
 * размытием заднего плана. Оборачивайте в <AnimatePresence>, чтобы работала
 * анимация выхода.
 *
 * Размытие стоит, пока экран на месте (с blurDelayMs — с момента, когда он замер).
 * С первого кадра ухода его нет — подложка гаснет одной прозрачностью: под ней в
 * этот момент уже идёт забег (или сцена меню), и размытие пересчитывалось бы на
 * каждом кадре все 0.28 с ухода.
 */
export function Overlay({ children, onBackdropClick, blur, blurDelayMs = 0, layer = 30, className = '', label, inert = false }: OverlayProps) {
  const isPresent = useIsPresent();
  const [settled, setSettled] = useState(blurDelayMs <= 0);

  useEffect(() => {
    if (blurDelayMs <= 0) return;
    const timer = window.setTimeout(() => setSettled(true), blurDelayMs);
    return () => window.clearTimeout(timer);
  }, [blurDelayMs]);

  const blurNow = isPresent && (settled || blurDelayMs <= 0);
  return (
    <motion.div
      role="presentation"
      aria-label={label}
      // React 19 снимает атрибут при false.
      inert={inert}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      onPointerDown={(e) => {
        if (onBackdropClick && e.target === e.currentTarget) onBackdropClick();
      }}
      className={[
        'fixed inset-0 flex items-center justify-center overflow-y-auto bg-void/78',
        OUTER_PADDING,
        blur && blurNow ? BLUR[blur] : '',
        blur && blurDelayMs > 0 && isPresent ? BLUR_IN : '',
        layer === 40 ? 'z-40' : 'z-30',
        className,
      ].join(' ')}
    >
      {children}
    </motion.div>
  );
}
