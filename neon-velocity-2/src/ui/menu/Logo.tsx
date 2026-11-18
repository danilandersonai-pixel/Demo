import { useId } from 'react';
import './menu.css';
import { svgId } from './shared';

/** Наклон логотипа: «курсив скорости». */
const SKEW = -9;
/** Сдвиг, возвращающий наклонённую надпись в границы viewBox. */
const SHIFT = 150 * Math.tan((-SKEW * Math.PI) / 180);

/** Две полосы знака «II»: [x, ширина]. */
const BARS: readonly (readonly [number, number])[] = [
  [486, 34],
  [536, 34],
];
const BAR_TOP = 12;
const BAR_BOTTOM = 150;
/** Прорези в нижней части полос — как у ретро-солнца: к низу шире. */
const SLITS: readonly (readonly [number, number])[] = [
  [96, 3],
  [108, 4.5],
  [121, 6],
  [135, 7.5],
];

/**
 * Логотип второй редакции. Один SVG: надписи масштабируются вместе с шириной
 * контейнера и не переполняют его ни на каком экране, а textLength фиксирует
 * ширину строк — раскладка не «прыгает», пока догружается Orbitron.
 * Знак «II» — две наклонные полосы в градиенте солнца с прорезями; тот же
 * мотив повторяет кнопка «Играть».
 */
export function Logo() {
  const id = svgId(useId());
  return (
    <h1 className="m-0">
      <span className="sr-only">Neon Velocity II: Rhythm &amp; Dodge</span>
      <svg viewBox="0 0 600 196" className="nvm-logo" aria-hidden focusable="false">
        <defs>
          {/* Цвета темы — через style: var() и color-mix() надёжно работают именно в CSS-свойствах. */}
          <linearGradient id={`${id}-chrome`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: '#ffffff' }} />
            <stop offset="0.48" style={{ stopColor: 'color-mix(in srgb, var(--theme-a) 50%, #ffffff)' }} />
            <stop offset="0.52" style={{ stopColor: 'var(--theme-a)' }} />
            <stop offset="1" style={{ stopColor: 'color-mix(in srgb, var(--theme-a) 60%, #1a0540)' }} />
          </linearGradient>
          <linearGradient id={`${id}-sun`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: '#ffffff' }} />
            <stop offset="0.16" style={{ stopColor: 'var(--theme-c)' }} />
            <stop offset="1" style={{ stopColor: 'var(--theme-a)' }} />
          </linearGradient>
          <linearGradient id={`${id}-rule`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" style={{ stopColor: 'var(--theme-b)', stopOpacity: 0 }} />
            <stop offset="1" style={{ stopColor: 'var(--theme-b)' }} />
          </linearGradient>
          <mask id={`${id}-slits`}>
            <rect x="0" y="0" width="600" height="196" fill="#fff" />
            {SLITS.map(([y, h]) => (
              <rect key={y} x="460" y={y} width="140" height={h} fill="#000" />
            ))}
          </mask>
        </defs>

        <g transform={`translate(${SHIFT.toFixed(2)} 0) skewX(${SKEW})`} className="font-display font-black">
          {/* Тёмная подложка-обводка под каждой надписью: логотип читается и поверх солнца, и поверх города. */}
          <text x="6" y="58" fontSize="56" textLength="384" fill="none" stroke="#05050a" strokeOpacity="0.6" strokeWidth="7" strokeLinejoin="round">
            NEON
          </text>
          <g className="nvm-logo-neon animate-flicker">
            <text
              x="6"
              y="58"
              fontSize="56"
              textLength="384"
              fill="none"
              strokeWidth="2.2"
              strokeLinejoin="round"
              style={{ stroke: 'color-mix(in srgb, var(--theme-b) 72%, #ffffff)' }}
            >
              NEON
            </text>
          </g>
          <g className="nvm-logo-velocity">
            <text
              x="2"
              y="150"
              fontSize="96"
              textLength="462"
              lengthAdjust="spacingAndGlyphs"
              fill={`url(#${id}-chrome)`}
              stroke="#12041f"
              strokeWidth="5"
              strokeLinejoin="round"
              paintOrder="stroke"
            >
              VELOCITY
            </text>
          </g>
          <g className="nvm-logo-mark">
            <g mask={`url(#${id}-slits)`}>
              {BARS.map(([x, w]) => (
                <rect key={x} x={x} y={BAR_TOP} width={w} height={BAR_BOTTOM - BAR_TOP} fill={`url(#${id}-sun)`} stroke="#12041f" strokeWidth="3" paintOrder="stroke" />
              ))}
            </g>
            {BARS.map(([x, w]) => (
              <rect key={x} x={x} y={BAR_TOP} width={w} height={BAR_BOTTOM - BAR_TOP} fill="#ffffff" className="nvm-logo-beat" />
            ))}
          </g>
        </g>

        {/* Подзаголовок между двумя «лучами». */}
        <rect x="6" y="176" width="118" height="2" fill={`url(#${id}-rule)`} />
        <rect x="476" y="176" width="118" height="2" fill={`url(#${id}-rule)`} transform="rotate(180 535 177)" />
        <text
          x="300"
          y="184"
          textAnchor="middle"
          fontSize="20"
          textLength="324"
          stroke="#05050a"
          strokeOpacity="0.85"
          strokeWidth="5"
          strokeLinejoin="round"
          paintOrder="stroke"
          className="font-mono font-bold"
          style={{ fill: 'color-mix(in srgb, var(--theme-b) 72%, #ffffff)' }}
        >
          RHYTHM &amp; DODGE
        </text>
      </svg>
    </h1>
  );
}
