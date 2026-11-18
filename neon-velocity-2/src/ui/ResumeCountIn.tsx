/**
 * Отсчёт после паузы: цифры «2», «1» в долю, пока мир стоит (сам отсчёт ведёт
 * ResumeCountIn в hud/loop.ts, цифру сюда приносит hudStore). За эти две доли
 * игрок находит корабль и возвращает к нему курсор.
 *
 * Слой прозрачен для указателя и лежит над уходящим экраном паузы (z-35 — между
 * экранами и панелями). Цифр две, по обе стороны дороги: замерший мир на самой
 * дороге — корабль и всё, что к нему летит, — остаётся открытым.
 */
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useResumeCount } from './hudStore';
import './ResumeCountIn.css';

const SIDES = ['left', 'right'] as const;

/** Цифра «падает» на долю за 0.16 с — доля длится 0.47 с, дольше качаться ей некогда — и гаснет, уступая следующей. */
const POP = { duration: 0.16, ease: [0.16, 1, 0.3, 1], opacity: { duration: 0.08 } } as const;
const FADE = { opacity: 0, scale: 0.7, transition: { duration: 0.12, ease: 'easeIn' } } as const;
const STILL = { duration: 0 } as const;

export function ResumeCountIn() {
  const count = useResumeCount();
  // Отсчёт функционален и при «меньше движения» остаётся — цифры просто сменяют друг друга.
  const still = useReducedMotion() === true;

  return (
    <div className="nvr-layer">
      <span role="status" className="sr-only">
        {count > 0 ? 'Забег продолжается' : ''}
      </span>
      <div aria-hidden>
        <AnimatePresence initial={false}>
          {count > 0 &&
            SIDES.map((side) => (
              <motion.span
                key={`${side}-${count}`}
                data-side={side}
                className="nvr-digit font-display"
                initial={still ? false : { opacity: 0, scale: 1.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={still ? { opacity: 0, transition: STILL } : FADE}
                transition={still ? STILL : POP}
              >
                {count}
              </motion.span>
            ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
