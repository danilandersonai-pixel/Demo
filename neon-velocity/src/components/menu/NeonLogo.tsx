import { motion, type Variants } from 'framer-motion';
import { EASE_OUT } from './shared';
import './menu.css';

const WORD = 'VELOCITY';
const LETTERS = WORD.split('');

const letterList: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045, delayChildren: 0.15 } },
};

const letter: Variants = {
  hidden: { opacity: 0, y: '-0.45em', scale: 1.25 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.55, ease: EASE_OUT } },
};

/**
 * Логотип «NEON VELOCITY»: неоновая трубка «NEON» с перебоями, хромированное
 * «VELOCITY» с розово-бирюзовыми хроматическими двойниками и редким глитчем
 * срезами, подзаголовок «RHYTHM & DODGE». Буквы влетают каскадом.
 */
export function NeonLogo({ className = '' }: { className?: string }) {
  return (
    <h1 className={['relative flex select-none flex-col items-center text-center', className].join(' ')}>
      <span className="sr-only">Neon Velocity: Rhythm &amp; Dodge</span>

      <motion.span
        aria-hidden
        className="nvm-logo-neon font-display font-black text-[#ffd9f6] text-glow-pink"
        initial={{ opacity: 0 }}
        // Трубка «зажигается» с перебоями, дальше мерцает CSS-анимация.
        animate={{ opacity: [0, 1, 0.15, 1, 0.4, 1] }}
        transition={{ duration: 0.9, times: [0, 0.12, 0.2, 0.34, 0.45, 0.6], delay: 0.05 }}
      >
        <span className="nvm-tube inline-block pl-[0.62em] tracking-[0.62em]">NEON</span>
      </motion.span>

      <span aria-hidden className="nvm-logo-main relative mt-[0.08em] inline-block font-display font-black tracking-[0.03em]">
        <motion.span
          className="nvm-chroma nvm-chroma-pink"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.8 }}
          transition={{ delay: 0.65, duration: 0.5 }}
        >
          {WORD}
        </motion.span>
        <motion.span
          className="nvm-chroma nvm-chroma-cyan"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.8 }}
          transition={{ delay: 0.65, duration: 0.5 }}
        >
          {WORD}
        </motion.span>
        <motion.span className="relative inline-block" variants={letterList} initial="hidden" animate="show">
          {LETTERS.map((ch, i) => (
            <motion.span key={i} className="inline-block" variants={letter}>
              <span className="nvm-chrome inline-block">{ch}</span>
            </motion.span>
          ))}
        </motion.span>
        <span className="nvm-glitch nvm-glitch-a">{WORD}</span>
        <span className="nvm-glitch nvm-glitch-b">{WORD}</span>
      </span>

      <motion.span
        aria-hidden
        className="mt-[0.9em] flex items-center gap-3 [@media(max-height:560px)]:mt-1.5 text-[10px] font-bold text-neon-yellow text-glow-yellow sm:gap-4 sm:text-sm"
        initial={{ opacity: 0, letterSpacing: '1.1em' }}
        animate={{ opacity: 1, letterSpacing: '0.55em' }}
        transition={{ delay: 0.55, duration: 0.8, ease: EASE_OUT }}
      >
        <span className="h-px w-8 bg-linear-to-r from-transparent to-neon-yellow shadow-[0_0_6px_#ffe94a] sm:w-20" />
        <span className="pl-[0.55em]">RHYTHM &amp; DODGE</span>
        <span className="h-px w-8 bg-linear-to-l from-transparent to-neon-yellow shadow-[0_0_6px_#ffe94a] sm:w-20" />
      </motion.span>
    </h1>
  );
}
