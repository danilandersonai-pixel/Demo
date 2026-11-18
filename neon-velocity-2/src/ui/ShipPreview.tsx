/**
 * SVG-превью корабля: тот же контур, что рисует Canvas (SHIP_GEOMETRY), в цветах
 * shipColors(skin, theme). Перки видны прямо на превью — шлейф, поле магнита,
 * кольцо щита, — поэтому карточку в магазине можно «прочитать» без текста.
 */
import { useId } from 'react';
import { shipColors } from '../core/config';
import { SHIP_GEOMETRY, toSvgPoints, type Point } from '../core/shipGeometry';
import type { Skin, Theme } from '../core/types';
import './menu/menu.css';
import { svgId } from './menu/shared';

export interface ShipPreviewProps {
  skin: Skin;
  theme: Theme;
  /** Сторона квадрата, px. Без неё превью занимает всю ширину контейнера. */
  size?: number;
  /** Пламя, шлейф и поля живые; false — статичная иконка (строки таблицы рекордов). */
  animated?: boolean;
  /** Рисовать перки: шлейф, поле магнита, щит. */
  perks?: boolean;
  className?: string;
}

/** Половина раствора дуг магнитного поля, рад. */
const FIELD_SPREAD = 0.62;
const FIELD_RADII = [1.3, 1.5] as const;
/** Радиус кольца щита у кораблей без собственного кольца в геометрии. */
const SHIELD_RADIUS = 1.47;

function fieldArc(radius: number, side: 1 | -1): string {
  const x = Math.cos(FIELD_SPREAD) * radius * side;
  const y = Math.sin(FIELD_SPREAD) * radius;
  return `M${x.toFixed(3)},${(-y).toFixed(3)} A${radius},${radius} 0 0 ${side > 0 ? 1 : 0} ${x.toFixed(3)},${y.toFixed(3)}`;
}

function flamePoints([x, y]: Point): string {
  return `${x - 0.14},${y} ${x + 0.14},${y} ${x},${y + 0.62}`;
}

/** Превью декоративно — рядом всегда стоит название корабля, — поэтому от скринридера оно скрыто. */
export function ShipPreview({ skin, theme, size, animated = true, perks = true, className = '' }: ShipPreviewProps) {
  const id = svgId(useId());
  const geometry = SHIP_GEOMETRY[skin.shape];
  const { hull, core } = shipColors(skin, theme);
  const [coreX, coreY] = geometry.core;
  const showTrail = perks && skin.perks.trail;
  const showMagnet = perks && skin.perks.magnet;
  const showShield = perks && skin.perks.shieldCharges > 0 && geometry.ring === 0;
  // Свечение масштабируется вместе с превью: у иконки в строке таблицы оно не должно «съедать» контур.
  const glow = size ? Math.max(1.5, size * 0.06) : 5;

  return (
    <svg
      viewBox="-1.6 -1.6 3.2 3.2"
      width={size}
      height={size}
      aria-hidden
      focusable="false"
      className={['nvm-ship block shrink-0', animated ? 'nvm-ship--live' : '', size ? '' : 'h-auto w-full', className].join(' ')}
      style={{ filter: `drop-shadow(0 0 ${glow}px ${hull})` }}
    >
      <defs>
        <linearGradient id={`${id}-hull`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={hull} stopOpacity="0.34" />
          <stop offset="1" stopColor={hull} stopOpacity="0.06" />
        </linearGradient>
        <linearGradient id={`${id}-flame`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={core} />
          <stop offset="0.45" stopColor={theme.colors.trail} stopOpacity="0.85" />
          <stop offset="1" stopColor={theme.colors.trail} stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}-core`}>
          <stop offset="0" stopColor={core} />
          <stop offset="0.35" stopColor={core} stopOpacity="0.55" />
          <stop offset="1" stopColor={hull} stopOpacity="0" />
        </radialGradient>
      </defs>

      {showMagnet && (
        <g fill="none" stroke={theme.colors.crystal} strokeLinecap="round" className="nvm-ship-field">
          {FIELD_RADII.map((r, i) => (
            <g key={r} strokeWidth={0.05 - i * 0.012} opacity={0.8 - i * 0.35}>
              <path d={fieldArc(r, -1)} />
              <path d={fieldArc(r, 1)} />
            </g>
          ))}
        </g>
      )}

      {showShield && (
        <circle
          r={SHIELD_RADIUS}
          fill="none"
          stroke={core}
          strokeWidth={0.04}
          strokeDasharray="0.42 0.16"
          opacity={0.6}
          className="nvm-ship-ring"
        />
      )}

      {geometry.ring > 0 && (
        <g className="nvm-ship-ring">
          <circle r={geometry.ring} fill={hull} fillOpacity={0.07} stroke={hull} strokeWidth={0.05} strokeDasharray="0.5 0.14" opacity={0.85} />
        </g>
      )}

      {showTrail &&
        geometry.engines.map(([x, y], engine) =>
          [0, 1, 2].map((i) => {
            const side = 0.12 - i * 0.022;
            return (
              <rect
                key={`${engine}-${i}`}
                x={x - side / 2}
                y={y + 0.2 + i * 0.15}
                width={side}
                height={side}
                fill={theme.colors.trail}
                opacity={0.8 - i * 0.22}
                className="nvm-ship-trail"
                style={{ animationDelay: `${-i * 0.21 - engine * 0.1}s` }}
              />
            );
          }),
        )}

      {geometry.engines.map((engine, i) => (
        <polygon
          key={i}
          points={flamePoints(engine)}
          fill={`url(#${id}-flame)`}
          className="nvm-ship-flame"
          style={{ animationDelay: `${-i * 0.09}s` }}
        />
      ))}

      <polygon
        points={toSvgPoints(geometry.hull)}
        fill={`url(#${id}-hull)`}
        stroke={hull}
        strokeWidth={0.085}
        strokeLinejoin="round"
      />
      <polygon
        points={toSvgPoints(geometry.inner)}
        fill={core}
        fillOpacity={0.16}
        stroke={hull}
        strokeOpacity={0.75}
        strokeWidth={0.045}
        strokeLinejoin="round"
      />
      <circle cx={coreX} cy={coreY} r={0.42} fill={`url(#${id}-core)`} className="nvm-ship-core" />
      <circle cx={coreX} cy={coreY} r={0.1} fill={core} />
    </svg>
  );
}
