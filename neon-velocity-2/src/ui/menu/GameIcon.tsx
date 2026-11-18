import type { ReactNode } from 'react';
import { TAU } from '../../core/math';
import './menu.css';

export type GameIconKind = 'cube' | 'saw' | 'laser' | 'crystal' | 'rare' | 'marker';

export interface GameIconProps {
  kind: GameIconKind;
  /** Сторона значка, px. */
  size?: number;
}

/** Цвета — акценты текущей темы: те же роли, что у объектов на дороге. */
const COLOR: Record<GameIconKind, string> = {
  cube: 'var(--theme-a)',
  saw: 'var(--theme-c)',
  laser: '#ff3b6b',
  crystal: 'var(--theme-b)',
  rare: 'var(--theme-c)',
  marker: 'var(--theme-b)',
};

/** Зубчатый контур пилы: чередование внешнего и внутреннего радиусов. */
function sawTeeth(cx: number, cy: number, outer: number, inner: number, teeth: number): string {
  const points: string[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * TAU;
    const b = ((i + 0.62) / teeth) * TAU;
    points.push(`${(cx + Math.cos(a) * outer).toFixed(2)},${(cy + Math.sin(a) * outer).toFixed(2)}`);
    points.push(`${(cx + Math.cos(b) * inner).toFixed(2)},${(cy + Math.sin(b) * inner).toFixed(2)}`);
  }
  return points.join(' ');
}

const SAW = sawTeeth(24, 24, 18, 13.2, 12);

function shape(kind: GameIconKind, color: string): ReactNode {
  switch (kind) {
    case 'cube':
      return (
        <g fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round">
          <path d="M9,17 H31 V39 H9 Z" fill={color} fillOpacity={0.14} />
          <path d="M17,9 H39 V31" />
          <path d="M9,17 L17,9 M31,17 L39,9 M31,39 L39,31" />
          <path d="M17,9 V17 M31,31 H39" strokeOpacity={0.35} strokeWidth={1.2} />
        </g>
      );
    case 'saw':
      return (
        <g stroke={color} strokeLinejoin="round">
          <polygon points={SAW} fill={color} fillOpacity={0.14} strokeWidth={1.8} />
          <circle cx={24} cy={24} r={7.5} fill="none" strokeWidth={1.2} strokeOpacity={0.55} />
          <circle cx={24} cy={24} r={2.6} fill={color} stroke="none" />
          <path d="M7,44 l3,-4 M41,44 l-3,-4 M24,45 v-3" strokeWidth={1.4} strokeLinecap="round" strokeOpacity={0.8} />
        </g>
      );
    case 'laser':
      return (
        <g stroke={color} strokeLinecap="round" strokeLinejoin="round">
          {/* Стойки-излучатели и луч с проходом посередине. */}
          <path d="M3,15 h6 v18 h-6 Z M39,15 h6 v18 h-6 Z" fill={color} fillOpacity={0.2} strokeWidth={1.6} />
          <path d="M9,24 H17 M31,24 H39" strokeWidth={4.4} strokeOpacity={0.45} />
          <path d="M9,24 H17 M31,24 H39" stroke="#ffffff" strokeWidth={1.4} />
          <path d="M19.5,17 h-2.5 v14 h2.5 M28.5,17 h2.5 v14 h-2.5" fill="none" strokeWidth={1.6} />
          <path d="M24,38 v-9 M21,32 l3,-3 l3,3" fill="none" stroke="var(--theme-b)" strokeWidth={1.6} />
        </g>
      );
    case 'crystal':
    case 'rare':
      return (
        <g stroke={color} strokeLinejoin="round">
          <circle cx={24} cy={24} r={19} fill={color} fillOpacity={0.1} stroke="none" />
          <path d="M24,6 L37,20 L24,42 L11,20 Z" fill={color} fillOpacity={0.2} strokeWidth={2} />
          <path d="M11,20 H37 M24,6 L18.5,20 L24,42 L29.5,20 Z" fill="none" strokeWidth={1.1} strokeOpacity={0.7} />
          <circle cx={24} cy={20} r={2.2} fill="#ffffff" stroke="none" />
          {kind === 'rare' && <path d="M40,7 v6 M37,10 h6 M8,34 v5 M5.5,36.5 h5" strokeWidth={1.5} strokeLinecap="round" />}
        </g>
      );
    case 'marker':
      return (
        <g strokeLinecap="round" strokeLinejoin="round">
          {/* Препятствие идёт зигзагом, а метка уже горит там, где оно пересечёт линию. */}
          <path d="M12,5 h8 v8 h-8 Z" fill="var(--theme-a)" fillOpacity={0.18} stroke="var(--theme-a)" strokeWidth={1.6} />
          <path d="M16,15 C8,21 36,27 30,35" fill="none" stroke="var(--theme-a)" strokeWidth={1.4} strokeDasharray="2.4 3" strokeOpacity={0.85} />
          <path d="M4,39 H44" stroke={color} strokeWidth={1.3} strokeOpacity={0.6} />
          <path d="M22,39 H38" stroke={color} strokeWidth={5} className="nvm-marker-pulse" />
          <path d="M22,39 H38" stroke="#ffffff" strokeWidth={1.4} />
          <path d="M22,35 v8 M38,35 v8" stroke={color} strokeWidth={1.6} />
        </g>
      );
  }
}

/** Значки игровых объектов для справки: каркасный куб, пила, лазерные ворота, сферы, метка прилёта. */
export function GameIcon({ kind, size = 48 }: GameIconProps) {
  const color = COLOR[kind];
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      aria-hidden
      focusable="false"
      className="block shrink-0"
      style={{ color, filter: `drop-shadow(0 0 ${Math.max(2, size * 0.08)}px ${color})` }}
    >
      {shape(kind, color)}
    </svg>
  );
}
