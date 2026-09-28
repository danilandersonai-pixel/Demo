/**
 * SVG-превью корабля для магазина, меню и таблицы рекордов. Контуры — те же
 * SHIP_GEOMETRY, что рисует холст, цвета — shipColors(skin, theme), поэтому
 * превью выглядит как корабль в игре: тёмный корпус, неоновый двойной штрих,
 * светящееся ядро, факелы из сопел и признаки перков (шлейф, магнит, щит).
 */
import { useId } from 'react';
import { shipColors } from '../game/config';
import { lighten } from '../game/math';
import { SHIP_GEOMETRY, toSvgPoints } from '../game/shipGeometry';
import type { Skin, Theme } from '../game/types';
import './menu/menu.css';

export interface ShipPreviewProps {
  skin: Skin;
  theme: Theme;
  /** Сторона квадрата в CSS-пикселях. */
  size?: number;
  /** Парение, дрожание факелов, частицы шлейфа и вращение колец. */
  animated?: boolean;
  className?: string;
}

/** Радиус щита, если у корпуса нет своего кольца (как у рендера на холсте, но внутри viewBox). */
const SHIELD_FALLBACK = 1.25;
/** Радиус «поля» магнита в превью — у края viewBox. */
const MAGNET_RING = 1.5;
/** Смещения частиц шлейфа под соплом: [dx, задержка анимации в долях цикла]. */
const TRAIL_DOTS: readonly (readonly [number, number])[] = [
  [-0.05, 0],
  [0.07, 0.33],
  [-0.02, 0.66],
];

export function ShipPreview({ skin, theme, size = 96, animated = true, className = '' }: ShipPreviewProps) {
  // useId даёт «:r1:»/««r1»» — в url(#…) такие символы ненадёжны.
  const uid = 'sp' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const geo = SHIP_GEOMETRY[skin.shape];
  const { hull, core } = shipColors(skin, theme);
  const hot = lighten(hull, 0.45);
  const flameColor = theme.colors.trail;
  const shieldR = geo.ring > 0 ? geo.ring : skin.perks.shieldCharges > 0 ? SHIELD_FALLBACK : 0;
  const multiEngine = geo.engines.length > 1;
  const flameW = multiEngine ? 0.13 : 0.18;
  const flameLen = multiEngine ? 0.5 : 0.62;
  const hullPoints = toSvgPoints(geo.hull);
  const anim = (cls: string) => (animated ? cls : '');

  return (
    <svg
      viewBox="-1.6 -1.6 3.2 3.2"
      width={size}
      height={size}
      role="img"
      aria-label={`Корабль ${skin.name}`}
      className={['shrink-0 overflow-visible', className].join(' ')}
    >
      <defs>
        <filter id={`${uid}-glow`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="0.05" result="soft" />
          <feGaussianBlur in="SourceGraphic" stdDeviation="0.16" result="wide" />
          <feMerge>
            <feMergeNode in="wide" />
            <feMergeNode in="soft" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <radialGradient id={`${uid}-core`}>
          <stop offset="0%" stopColor={core} stopOpacity="1" />
          <stop offset="35%" stopColor={hull} stopOpacity="0.55" />
          <stop offset="100%" stopColor={hull} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${uid}-halo`}>
          <stop offset="0%" stopColor={hull} stopOpacity="0.32" />
          <stop offset="100%" stopColor={hull} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${uid}-flame`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="30%" stopColor={flameColor} stopOpacity="0.9" />
          <stop offset="100%" stopColor={flameColor} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Мягкий ореол и «пятно света на полу». */}
      <circle r="1.45" fill={`url(#${uid}-halo)`} />
      <ellipse cx="0" cy="1.42" rx="0.9" ry="0.14" fill={hull} opacity="0.18" />

      {skin.perks.magnet && (
        <g className={anim('nvm-spin-slow')}>
          <circle
            r={MAGNET_RING}
            fill="none"
            stroke={theme.colors.crystal}
            strokeWidth="0.03"
            strokeDasharray="0.12 0.1"
            opacity="0.45"
          />
        </g>
      )}

      <g className={anim('nvm-ship-float')}>
        <g className="nvm-ship-lift">
          {/* Факелы под корпусом. */}
          {geo.engines.map(([ex, ey], i) => (
            <path
              key={`f${i}`}
              className={anim('nvm-flame')}
              style={animated ? { animationDelay: `${i * -0.07}s` } : undefined}
              d={`M ${ex - flameW / 2} ${ey} L ${ex + flameW / 2} ${ey} L ${ex} ${ey + flameLen} Z`}
              fill={`url(#${uid}-flame)`}
            />
          ))}

          {/* Шлейф: пиксели, стекающие из сопел. */}
          {skin.perks.trail &&
            geo.engines.map(([ex, ey], i) =>
              TRAIL_DOTS.map(([dx, delay], j) => (
                <rect
                  key={`t${i}-${j}`}
                  className={anim('nvm-trail-dot')}
                  style={animated ? { animationDelay: `${-(delay + i * 0.17) * 1.1}s` } : undefined}
                  x={ex + dx - 0.035}
                  y={ey + 0.32 + j * (animated ? 0 : 0.18)}
                  width="0.07"
                  height="0.07"
                  fill={theme.colors.trail}
                  opacity={animated ? undefined : 0.8 - j * 0.25}
                />
              )),
            )}

          {/* Корпус: тёмное тело, широкий полупрозрачный штрих, тонкий яркий. */}
          <g filter={`url(#${uid}-glow)`}>
            <polygon points={hullPoints} fill="#07060f" fillOpacity="0.88" />
            <polygon points={hullPoints} fill={hull} fillOpacity="0.14" />
            <polygon
              points={hullPoints}
              fill="none"
              stroke={hull}
              strokeWidth="0.13"
              strokeOpacity="0.35"
              strokeLinejoin="round"
            />
            <polygon points={hullPoints} fill="none" stroke={hot} strokeWidth="0.05" strokeLinejoin="round" />
            <polygon
              points={toSvgPoints(geo.inner)}
              fill="none"
              stroke={hot}
              strokeWidth="0.03"
              strokeOpacity="0.8"
              strokeLinejoin="round"
            />
          </g>

          {/* Ядро. */}
          <circle cx={geo.core[0]} cy={geo.core[1]} r="0.42" fill={`url(#${uid}-core)`} />
          <circle cx={geo.core[0]} cy={geo.core[1]} r="0.1" fill={core} />
        </g>
      </g>

      {/* Щит-призрак: двойной контур и вращающиеся сегменты. */}
      {shieldR > 0 && (
        <g>
          <circle r={shieldR} fill="none" stroke={hull} strokeWidth="0.1" opacity="0.18" />
          <circle r={shieldR} fill="none" stroke={hull} strokeWidth="0.03" opacity="0.8" />
          <g className={anim('nvm-spin-rev')}>
            <circle
              r={shieldR * 1.1}
              fill="none"
              stroke={hull}
              strokeWidth="0.04"
              strokeDasharray={`${((Math.PI * 2 * shieldR * 1.1) / 6) * 0.7} ${((Math.PI * 2 * shieldR * 1.1) / 6) * 0.3}`}
              opacity="0.5"
            />
          </g>
        </g>
      )}
    </svg>
  );
}
