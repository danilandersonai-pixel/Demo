/**
 * Мини-сцена темы для магазина: небо градиентом, полосатое ретро-солнце,
 * неоновые горы и перспективная сетка — те же слои, что рисует холст, только
 * в SVG и в цветах выбранной темы.
 */
import { useId } from 'react';
import type { Theme } from '../game/types';
import './menu/menu.css';

export interface ThemePreviewProps {
  theme: Theme;
  className?: string;
}

const W = 160;
const H = 90;
/** Линия горизонта и центр солнца. */
const HORIZON = 52;
const SUN = { x: 80, y: 41, r: 23 };
/** Прорези в нижней половине солнца: [y, толщина] — к горизонту шире. */
const SUN_SLITS: readonly (readonly [number, number])[] = [
  [40, 0.9],
  [43.5, 1.4],
  [46.8, 1.9],
  [50, 2.6],
];
/** Силуэт гор: по краям выше, в центре — «долина», чтобы солнце было видно. */
const MOUNTAINS =
  `0,${HORIZON} 0,38 9,33 17,40 26,29 36,41 44,35 52,44 60,47 70,50 90,50 100,47 108,43 ` +
  `116,34 125,41 133,30 142,39 151,33 160,37 160,${HORIZON}`;
/** Детерминированные звёзды — превью не должно «мигать» при перерисовке. */
const STARS: readonly (readonly [number, number, number])[] = [
  [12, 8, 0.5],
  [27, 17, 0.35],
  [41, 6, 0.45],
  [55, 21, 0.3],
  [104, 9, 0.5],
  [118, 20, 0.35],
  [131, 5, 0.4],
  [146, 15, 0.55],
  [152, 26, 0.3],
  [7, 25, 0.35],
  [66, 4, 0.3],
  [93, 15, 0.3],
];

const VERTICALS = Array.from({ length: 21 }, (_, i) => i - 10);
const HORIZONTALS = Array.from({ length: 8 }, (_, i) => HORIZON + (H - HORIZON) * Math.pow((i + 1) / 8, 2.1));

export function ThemePreview({ theme, className = '' }: ThemePreviewProps) {
  const uid = 'tp' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const c = theme.colors;
  const grid = c.grid[0];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={`Превью темы ${theme.name}`}
      className={['block h-full w-full', className].join(' ')}
    >
      <defs>
        <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c.skyTop} />
          <stop offset="100%" stopColor={c.skyBottom} />
        </linearGradient>
        <linearGradient id={`${uid}-sun`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c.sunTop} />
          <stop offset="100%" stopColor={c.sunBottom} />
        </linearGradient>
        <radialGradient id={`${uid}-sunglow`}>
          <stop offset="0%" stopColor={c.sunBottom} stopOpacity="0.55" />
          <stop offset="100%" stopColor={c.sunBottom} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${uid}-floor`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c.skyBottom} stopOpacity="0.55" />
          <stop offset="100%" stopColor={c.bg} />
        </linearGradient>
        {/* Линии сетки гаснут к горизонту. */}
        <linearGradient id={`${uid}-grid`} gradientUnits="userSpaceOnUse" x1="0" y1={HORIZON} x2="0" y2={H}>
          <stop offset="0%" stopColor={grid} stopOpacity="0.15" />
          <stop offset="100%" stopColor={grid} stopOpacity="1" />
        </linearGradient>
        <mask id={`${uid}-slits`}>
          <rect x="0" y="0" width={W} height={H} fill="#fff" />
          {SUN_SLITS.map(([y, h]) => (
            <rect key={y} x="0" y={y - h / 2} width={W} height={h} fill="#000" />
          ))}
        </mask>
        <clipPath id={`${uid}-sky-clip`}>
          <rect x="0" y="0" width={W} height={HORIZON} />
        </clipPath>
        <filter id={`${uid}-blur`} x="-20%" y="-200%" width="140%" height="500%">
          <feGaussianBlur stdDeviation="1.2" />
        </filter>
      </defs>

      {/* Небо и звёзды. */}
      <rect x="0" y="0" width={W} height={HORIZON} fill={`url(#${uid}-sky)`} />
      {STARS.map(([x, y, r]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill="#fff" opacity={0.35 + r} />
      ))}

      {/* Солнце: свечение, диск с прорезями, обрезанный горизонтом. */}
      <g clipPath={`url(#${uid}-sky-clip)`}>
        <circle className="nvm-sun-glow" cx={SUN.x} cy={SUN.y} r={SUN.r * 1.9} fill={`url(#${uid}-sunglow)`} />
        <circle cx={SUN.x} cy={SUN.y} r={SUN.r} fill={`url(#${uid}-sun)`} mask={`url(#${uid}-slits)`} />
      </g>

      {/* Горы с неоновым гребнем. */}
      <polygon points={MOUNTAINS} fill={c.bg} fillOpacity="0.92" />
      <polyline points={MOUNTAINS} fill="none" stroke={c.accent2} strokeWidth="0.6" strokeOpacity="0.75" strokeLinejoin="round" />

      {/* Пол и перспективная сетка. */}
      <rect x="0" y={HORIZON} width={W} height={H - HORIZON} fill={`url(#${uid}-floor)`} />
      <g stroke={`url(#${uid}-grid)`} strokeWidth="0.55">
        {VERTICALS.map((i) => (
          <line key={`v${i}`} x1={W / 2 + i * 3.2} y1={HORIZON} x2={W / 2 + i * 26} y2={H} />
        ))}
        {HORIZONTALS.map((y) => (
          <line key={`h${y}`} x1="0" y1={y} x2={W} y2={y} />
        ))}
      </g>

      {/* Светящаяся линия горизонта. */}
      <line x1="0" y1={HORIZON} x2={W} y2={HORIZON} stroke={grid} strokeWidth="2.4" opacity="0.6" filter={`url(#${uid}-blur)`} />
      <line x1="0" y1={HORIZON} x2={W} y2={HORIZON} stroke={grid} strokeWidth="0.7" />
    </svg>
  );
}
