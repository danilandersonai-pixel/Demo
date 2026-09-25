import { useId } from 'react';
import { THEMES } from '../../game/config';
import { TAU } from '../../game/math';

export type IconKind = 'cube' | 'saw' | 'laser' | 'crystal' | 'rare';

/** Справка показывает объекты в классических цветах — как в теме по умолчанию. */
const COLORS = THEMES.cyberpunk.colors;

const COLOR: Record<IconKind, string> = {
  cube: COLORS.cube,
  saw: COLORS.saw,
  laser: COLORS.laser,
  crystal: COLORS.crystal,
  rare: COLORS.crystalRare,
};

/** Зубья пилы: внешняя вершина чуть впереди по вращению — диск «режет». */
const SAW_TEETH = 12;
const SAW_POINTS = Array.from({ length: SAW_TEETH }, (_, k) => {
  const a = (k / SAW_TEETH) * TAU;
  const b = a + (TAU / SAW_TEETH) * 0.62;
  return `${(Math.cos(a) * 14).toFixed(2)},${(Math.sin(a) * 14).toFixed(2)} ${(Math.cos(b) * 19).toFixed(2)},${(Math.sin(b) * 19).toFixed(2)}`;
}).join(' ');

const SAW_HOLES = [0, 1, 2].map((i) => {
  const a = (i / 3) * TAU - Math.PI / 2;
  return [Math.cos(a) * 9.5, Math.sin(a) * 9.5] as const;
});

function Shape({ kind, color }: { kind: IconKind; color: string }) {
  switch (kind) {
    case 'cube':
      return (
        <g transform="rotate(18)" fill="none" stroke={color} strokeLinejoin="round">
          <rect x="-15" y="-15" width="30" height="30" strokeWidth="1.8" fill={color} fillOpacity="0.08" />
          <rect x="-7.5" y="-7.5" width="15" height="15" strokeWidth="1.1" strokeOpacity="0.85" />
          <path
            d="M -15 -15 L -7.5 -7.5 M 15 -15 L 7.5 -7.5 M 15 15 L 7.5 7.5 M -15 15 L -7.5 7.5"
            strokeWidth="1"
            strokeOpacity="0.7"
          />
        </g>
      );
    case 'saw':
      return (
        <g fill="none" stroke={color} strokeLinejoin="round">
          <polygon points={SAW_POINTS} strokeWidth="1.5" fill={color} fillOpacity="0.08" />
          <circle r="7" strokeWidth="1.1" strokeOpacity="0.85" />
          <circle r="2.4" fill={color} stroke="none" />
          {SAW_HOLES.map(([x, y]) => (
            <circle key={`${x}`} cx={x} cy={y} r="1.8" strokeWidth="0.9" strokeOpacity="0.8" />
          ))}
        </g>
      );
    case 'laser':
      return (
        <g>
          <rect x="-24" y="-3" width="15" height="6" fill={color} opacity="0.25" />
          <rect x="9" y="-3" width="15" height="6" fill={color} opacity="0.25" />
          <line x1="-24" y1="0" x2="-9" y2="0" stroke="#fff" strokeWidth="1.4" />
          <line x1="9" y1="0" x2="24" y2="0" stroke="#fff" strokeWidth="1.4" />
          <line x1="-24" y1="0" x2="-9" y2="0" stroke={color} strokeWidth="3" strokeOpacity="0.7" />
          <line x1="9" y1="0" x2="24" y2="0" stroke={color} strokeWidth="3" strokeOpacity="0.7" />
          <rect x="-11" y="-4.5" width="3" height="9" fill={color} />
          <rect x="8" y="-4.5" width="3" height="9" fill={color} />
          {/* Проход подсвечен пунктиром. */}
          <path d="M -7 -8 L -7 8 M 7 -8 L 7 8" stroke={color} strokeWidth="0.8" strokeDasharray="1.6 1.6" strokeOpacity="0.8" />
          <path d="M 0 5 L -2.4 9.5 L 2.4 9.5 Z" fill="#fff" fillOpacity="0.85" />
        </g>
      );
    case 'crystal':
    case 'rare': {
      const s = kind === 'rare' ? 1.15 : 1;
      return (
        <g transform={`scale(${s})`}>
          <circle r="15" fill={color} opacity="0.12" />
          <polygon
            points="0,-14 10,0 0,14 -10,0"
            fill={color}
            fillOpacity="0.16"
            stroke={color}
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path d="M -10 0 L 10 0 M 0 -14 L 0 14" stroke={color} strokeWidth="0.7" strokeOpacity="0.6" />
          <circle r="3" fill="#fff" />
          {kind === 'rare' && (
            <path
              d="M 13 -13 L 14 -10 L 17 -9 L 14 -8 L 13 -5 L 12 -8 L 9 -9 L 12 -10 Z M -14 9 L -13.4 11 L -11.5 11.6 L -13.4 12.2 L -14 14 L -14.6 12.2 L -16.5 11.6 L -14.6 11 Z"
              fill="#fff"
            />
          )}
        </g>
      );
    }
  }
}

/** Мини-иконка объекта игры для справки — чистый SVG в неоновом стиле холста. */
export function ObstacleIcon({ kind, size = 44 }: { kind: IconKind; size?: number }) {
  const uid = 'oi' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const color = COLOR[kind];
  return (
    <svg viewBox="-24 -24 48 48" width={size} height={size} aria-hidden className="shrink-0 overflow-visible">
      <defs>
        <filter id={`${uid}-glow`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter={`url(#${uid}-glow)`}>
        <Shape kind={kind} color={color} />
      </g>
    </svg>
  );
}
