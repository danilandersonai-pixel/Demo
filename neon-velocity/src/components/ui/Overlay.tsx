import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

export interface OverlayProps {
  children: ReactNode;
  /** Клик по фону вне содержимого. */
  onBackdropClick?: () => void;
  /**
   * Размытие заднего плана (backdrop-blur). Без пропа подложка только затемняет:
   * панели меню лежат над живой демо-сценой, и полноэкранный backdrop-filter
   * пересчитывался бы там каждый кадр. Пауза и Game Over размывают фон — под
   * ними холст заморожен или перерисовывается реже (см. GameCanvas).
   */
  blur?: 'sm' | 'md' | 'lg';
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

/**
 * Полноэкранная затемняющая подложка с плавным появлением и, по запросу,
 * размытием заднего плана. Оборачивайте в <AnimatePresence>, чтобы работала
 * анимация выхода.
 */
export function Overlay({ children, onBackdropClick, blur, layer = 30, className = '', label, inert = false }: OverlayProps) {
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
        blur ? BLUR[blur] : '',
        layer === 40 ? 'z-40' : 'z-30',
        className,
      ].join(' ')}
    >
      {children}
    </motion.div>
  );
}
