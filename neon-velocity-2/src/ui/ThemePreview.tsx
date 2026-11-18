/**
 * Мини-сцена темы: небо, полосатое солнце, СВОЙ горизонт (город / пальмы /
 * заводы / ледяные пики с сиянием), дорога в перспективе с бегущей сеткой и
 * объекты в цветах темы. Всё — один SVG из цветов Theme, без картинок.
 */
import { useId, type CSSProperties, type ReactNode } from 'react';
import type { Scenery, Theme, ThemeColors } from '../core/types';
import './menu/menu.css';
import { svgId } from './menu/shared';

export interface ThemePreviewProps {
  theme: Theme;
  /** Сетка дороги бежит на зрителя (карточка надетой темы, наведение, фокус). */
  live?: boolean;
}

const W = 160;
const H = 90;
/** Линия горизонта и точка схода. */
const HORIZON = 52;
const VX = W / 2;
/** Полуширина дороги у нижнего края кадра. */
const ROAD_HALF = 98;

/** Экранный Y поперечной линии сетки номер k (0 — у нижнего края кадра). */
function rowY(k: number): number {
  return HORIZON + (H - HORIZON) / (1 + 0.55 * k);
}

const ROWS = Array.from({ length: 8 }, (_, k) => ({ near: rowY(k), far: rowY(k + 1), k }));
const LANES = Array.from({ length: 9 }, (_, i) => VX - ROAD_HALF + (i * ROAD_HALF * 2) / 8);
const STARS: readonly (readonly [number, number, number])[] = [
  [12, 8, 0.5],
  [31, 17, 0.35],
  [47, 6, 0.45],
  [63, 13, 0.3],
  [99, 9, 0.45],
  [118, 16, 0.3],
  [134, 5, 0.5],
  [151, 12, 0.35],
  [22, 27, 0.3],
  [141, 26, 0.3],
];

// ─── Горизонты ──────────────────────────────────────────────────────────────

/** Силуэт из прямоугольников [x, ширина, высота], стоящих на горизонте. */
function skyline(blocks: readonly (readonly [number, number, number])[]): string {
  let d = `M0,${HORIZON}`;
  for (const [x, w, h] of blocks) d += ` L${x},${HORIZON} V${HORIZON - h} H${x + w} V${HORIZON}`;
  return d + ` L${W},${HORIZON} Z`;
}

const CITY_FAR = skyline([
  [0, 9, 8],
  [9, 6, 12],
  [17, 8, 6],
  [27, 7, 14],
  [36, 9, 9],
  [47, 6, 5],
  [55, 8, 7],
  [66, 7, 4],
  [76, 9, 5],
  [88, 6, 4],
  [96, 8, 8],
  [106, 6, 5],
  [113, 9, 11],
  [124, 7, 7],
  [133, 8, 15],
  [143, 6, 9],
  [151, 9, 6],
]);

/** Башни ближнего плана: [x, ширина, высота, антенна]. Центр кадра свободен — там солнце. */
const CITY_NEAR: readonly (readonly [number, number, number, number])[] = [
  [3, 9, 22, 0],
  [14, 7, 15, 0],
  [23, 10, 31, 5],
  [36, 6, 12, 0],
  [116, 7, 14, 0],
  [125, 10, 27, 4],
  [138, 7, 18, 0],
  [147, 10, 34, 6],
];

function CityScenery({ c }: { c: ThemeColors }) {
  return (
    <>
      <path d={CITY_FAR} fill={c.sceneryFar} fillOpacity={0.5} />
      {CITY_NEAR.map(([x, w, h, mast]) => (
        <g key={x}>
          <rect x={x} y={HORIZON - h} width={w} height={h} fill={c.bg} fillOpacity={0.94} stroke={c.sceneryNear} strokeWidth={0.5} />
          {mast > 0 && <line x1={x + w / 2} y1={HORIZON - h} x2={x + w / 2} y2={HORIZON - h - mast} stroke={c.sceneryNear} strokeWidth={0.4} />}
          {/* Окна: рисунок зависит только от координат — одинаков при каждом рендере. */}
          {Array.from({ length: Math.floor((h - 3) / 3) }, (_, row) =>
            Array.from({ length: Math.floor((w - 2) / 2.4) }, (_, col) =>
              (row * 7 + col * 5 + x) % 3 === 0 ? null : (
                <rect
                  key={`${row}-${col}`}
                  x={x + 1.4 + col * 2.4}
                  y={HORIZON - h + 2 + row * 3}
                  width={1}
                  height={1.3}
                  fill={(row + col + x) % 4 === 0 ? c.accent3 : c.sceneryNear}
                  opacity={0.75}
                />
              ),
            ),
          )}
        </g>
      ))}
    </>
  );
}

/** Пальмы: [x основания, высота, наклон кроны]. */
const PALMS: readonly (readonly [number, number, number])[] = [
  [13, 27, 4],
  [29, 17, -2],
  [133, 19, 2],
  [148, 29, -4],
];
const FRONDS: readonly (readonly [number, number])[] = [
  [-10, 3],
  [-8.5, -3],
  [-3.5, -6.5],
  [3.5, -6.5],
  [8.5, -3],
  [10, 3],
];

function PalmsScenery({ c }: { c: ThemeColors }) {
  return (
    <>
      <path
        d={`M0,${HORIZON} V45 C14,38 27,37 41,43 C51,47 59,48 68,47 C84,45 95,46 106,44 C122,38 141,36 ${W},43 V${HORIZON} Z`}
        fill={c.sceneryFar}
        fillOpacity={0.6}
      />
      {PALMS.map(([x, h, lean]) => {
        const topX = x + lean;
        const topY = HORIZON - h;
        const k = h / 27;
        return (
          <g key={x} fill="none" stroke={c.sceneryNear} strokeLinecap="round">
            <path d={`M${x},${HORIZON} Q${x + lean * 0.15},${HORIZON - h * 0.55} ${topX},${topY}`} strokeWidth={1} />
            {FRONDS.map(([fx, fy]) => (
              <path
                key={fx}
                d={`M${topX},${topY} Q${topX + fx * k * 0.5},${topY + fy * k * 0.5 - 3.4 * k} ${topX + fx * k},${topY + fy * k}`}
                strokeWidth={0.85}
              />
            ))}
          </g>
        );
      })}
    </>
  );
}

const TOXIC_FAR = skyline([
  [0, 10, 6],
  [10, 3, 13],
  [13, 9, 6],
  [24, 10, 9],
  [36, 8, 5],
  [46, 3, 14],
  [49, 9, 5],
  [60, 12, 3],
  [88, 12, 3],
  [102, 6, 6],
  [108, 3, 16],
  [111, 11, 6],
  [124, 12, 10],
  [138, 8, 5],
  [147, 3, 13],
  [150, 10, 5],
]);

/** Градирни: [x центра, ширина, высота]. */
const TOWERS: readonly (readonly [number, number, number])[] = [
  [19, 19, 21],
  [40, 13, 14],
  [123, 14, 15],
  [144, 20, 23],
];

function tower(x: number, w: number, h: number): string {
  const top = HORIZON - h;
  return [
    `M${x - w / 2},${HORIZON}`,
    `C${x - w * 0.34},${HORIZON - h * 0.45} ${x - w * 0.3},${HORIZON - h * 0.78} ${x - w * 0.36},${top}`,
    `H${x + w * 0.36}`,
    `C${x + w * 0.3},${HORIZON - h * 0.78} ${x + w * 0.34},${HORIZON - h * 0.45} ${x + w / 2},${HORIZON} Z`,
  ].join(' ');
}

function ToxicScenery({ c }: { c: ThemeColors }) {
  return (
    <>
      <path d={TOXIC_FAR} fill={c.sceneryFar} fillOpacity={0.5} />
      {TOWERS.map(([x, w, h]) => (
        <g key={x}>
          {/* Ядовитый пар над градирней. */}
          <circle cx={x + 1} cy={HORIZON - h - 3.5} r={w * 0.26} fill={c.haze} opacity={0.22} />
          <circle cx={x + 4} cy={HORIZON - h - 8.5} r={w * 0.2} fill={c.haze} opacity={0.15} />
          <circle cx={x + 2} cy={HORIZON - h - 12.5} r={w * 0.14} fill={c.haze} opacity={0.1} />
          <path d={tower(x, w, h)} fill={c.bg} fillOpacity={0.94} stroke={c.sceneryNear} strokeWidth={0.5} />
          <line x1={x - w * 0.31} y1={HORIZON - h * 0.7} x2={x + w * 0.31} y2={HORIZON - h * 0.7} stroke={c.sceneryNear} strokeWidth={0.3} opacity={0.6} />
        </g>
      ))}
      <path d={`M49,${HORIZON - 2.5} H62 M98,${HORIZON - 2.5} H113`} stroke={c.sceneryNear} strokeWidth={0.6} opacity={0.7} />
    </>
  );
}

const PEAKS = `M0,${HORIZON} V43 L8,35 L14,42 L22,27 L30,40 L36,33 L45,45 L55,47 L64,49 L96,49 L105,46 L114,37 L120,44 L130,25 L138,39 L146,30 L154,41 L${W},34 V${HORIZON} Z`;
const FACETS = 'M22,27 L25,45 M36,33 L34,46 M8,35 L10,46 M130,25 L127,45 M146,30 L148,46 M114,37 L116,47';

function AuroraScenery({ c, id }: { c: ThemeColors; id: string }) {
  return (
    <>
      {/* Занавес сияния: яркая кромка сверху, вниз тает. */}
      <path d="M-4,20 C22,6 44,26 74,13 S128,4 164,18 V40 C128,26 104,34 74,35 S22,28 -4,42 Z" fill={`url(#${id}-aurora)`} />
      <path d="M-4,20 C22,6 44,26 74,13 S128,4 164,18" fill="none" stroke={c.sceneryFar} strokeWidth={0.8} opacity={0.85} />
      <path d="M-4,31 C30,22 52,36 86,27 S134,20 164,30" fill="none" stroke={c.accent2} strokeWidth={0.6} opacity={0.5} />
      <path d={PEAKS} fill={c.bg} fillOpacity={0.94} stroke={c.sceneryNear} strokeWidth={0.5} strokeLinejoin="round" />
      <path d={FACETS} fill="none" stroke={c.sceneryNear} strokeWidth={0.3} opacity={0.5} />
    </>
  );
}

function sceneryFor(scenery: Scenery, c: ThemeColors, id: string): ReactNode {
  switch (scenery) {
    case 'city':
      return <CityScenery c={c} />;
    case 'palms':
      return <PalmsScenery c={c} />;
    case 'toxic':
      return <ToxicScenery c={c} />;
    case 'aurora':
      return <AuroraScenery c={c} id={id} />;
  }
}

// ─── Сцена ──────────────────────────────────────────────────────────────────

/** Сцена декоративна — рядом всегда стоит название темы, — поэтому от скринридера она скрыта. */
export function ThemePreview({ theme, live = false }: ThemePreviewProps) {
  const id = svgId(useId());
  const c = theme.colors;
  const grid = c.grid[0];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      focusable="false"
      className={live ? 'nvm-scene nvm-scene--live block h-full w-full' : 'nvm-scene block h-full w-full'}
      style={{ background: c.bg }}
    >
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c.skyTop} />
          <stop offset="1" stopColor={c.skyBottom} />
        </linearGradient>
        <linearGradient id={`${id}-sun`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c.sunTop} />
          <stop offset="1" stopColor={c.sunBottom} />
        </linearGradient>
        <linearGradient id={`${id}-haze`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c.haze} stopOpacity="0" />
          <stop offset="0.55" stopColor={c.haze} stopOpacity="0.42" />
          <stop offset="1" stopColor={c.haze} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-aurora`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c.sceneryFar} stopOpacity="0.6" />
          <stop offset="1" stopColor={c.sceneryFar} stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}-glow`}>
          <stop offset="0" stopColor={c.sunBottom} stopOpacity="0.5" />
          <stop offset="1" stopColor={c.sunBottom} stopOpacity="0" />
        </radialGradient>
        {/* Прорези ретро-солнца: к горизонту полосы шире. */}
        <mask id={`${id}-stripes`}>
          <rect x="0" y="0" width={W} height={H} fill="#fff" />
          <rect x="0" y="37.4" width={W} height="1" fill="#000" />
          <rect x="0" y="41" width={W} height="1.5" fill="#000" />
          <rect x="0" y="44.8" width={W} height="2" fill="#000" />
          <rect x="0" y="48.6" width={W} height="2.4" fill="#000" />
        </mask>
        <clipPath id={`${id}-road`}>
          <polygon points={`${VX},${HORIZON} ${VX + ROAD_HALF},${H} ${VX - ROAD_HALF},${H}`} />
        </clipPath>
      </defs>

      <rect x="0" y="0" width={W} height={HORIZON} fill={`url(#${id}-sky)`} />
      {STARS.map(([x, y, r]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill="#fff" opacity={0.7} />
      ))}
      <circle cx={VX} cy={HORIZON - 4} r={34} fill={`url(#${id}-glow)`} />
      <circle cx={VX} cy={HORIZON - 5} r={20} fill={`url(#${id}-sun)`} mask={`url(#${id}-stripes)`} />

      {sceneryFor(theme.scenery, c, id)}

      {/* Земля и дорога. */}
      <rect x="0" y={HORIZON} width={W} height={H - HORIZON} fill={c.bg} />
      <polygon points={`${VX},${HORIZON} ${VX + ROAD_HALF},${H} ${VX - ROAD_HALF},${H}`} fill={c.road} />
      <g clipPath={`url(#${id}-road)`} stroke={grid} fill="none">
        {LANES.map((x) => (
          <line key={x} x1={VX} y1={HORIZON} x2={x} y2={H} strokeWidth={0.45} opacity={0.55} />
        ))}
        {ROWS.map(({ near, far, k }) => (
          <line
            key={k}
            x1="0"
            x2={W}
            y1="0"
            y2="0"
            strokeWidth={0.4 + 0.5 / (1 + k)}
            className="nvm-scene-row"
            style={
              {
                '--row-from': `${far}px`,
                '--row-to': `${near}px`,
                '--row-fade': k === ROWS.length - 1 ? 0 : 0.2 + 0.7 / (2 + k),
                opacity: 0.2 + 0.7 / (1 + k),
                transform: `translateY(${near}px)`,
              } as CSSProperties
            }
          />
        ))}
      </g>
      {/* Бортики дороги: широкий тусклый штрих — свечение, тонкий — сама линия. */}
      <g stroke={c.rail} strokeLinecap="round">
        <path d={`M${VX},${HORIZON} L${VX - ROAD_HALF},${H} M${VX},${HORIZON} L${VX + ROAD_HALF},${H}`} strokeWidth={2.2} opacity={0.22} />
        <path d={`M${VX},${HORIZON} L${VX - ROAD_HALF},${H} M${VX},${HORIZON} L${VX + ROAD_HALF},${H}`} strokeWidth={0.7} />
      </g>
      <rect x="0" y={HORIZON - 9} width={W} height={18} fill={`url(#${id}-haze)`} />

      {/* Объекты в цветах темы: куб, пила, цепочка сфер и корабль на линии удара. */}
      <g fill="none" strokeLinejoin="round">
        <path d="M58,61 h6.4 v6.4 h-6.4 Z M60,59.2 h6.4 v6.4 M58,61 l2,-1.8 M64.4,61 l2,-1.8 M64.4,67.4 l2,-1.8" stroke={c.cube} strokeWidth={0.6} />
        <circle cx={101} cy={62.5} r={3} stroke={c.saw} strokeWidth={0.7} strokeDasharray="1.1 0.7" />
        <circle cx={101} cy={62.5} r={0.8} fill={c.saw} />
        <path d="M84,57.2 l1,1.3 l-1,1.3 l-1,-1.3 Z" fill={c.crystal} />
        <path d="M86.6,62.3 l1.4,1.8 l-1.4,1.8 l-1.4,-1.8 Z" fill={c.crystal} />
        <path d="M90,69.4 l1.9,2.4 l-1.9,2.4 l-1.9,-2.4 Z" fill={c.crystalRare} />
        <path d={`M${VX - 24},81.5 H${VX + 24}`} stroke={c.rail} strokeWidth={0.5} opacity={0.5} />
        <path d={`M${VX},76 l4.6,8.6 l-4.6,-1.7 l-4.6,1.7 Z`} fill={c.ship} fillOpacity={0.3} stroke={c.ship} strokeWidth={0.8} />
        <circle cx={VX} cy={80.8} r={0.9} fill={c.shipCore} />
      </g>
    </svg>
  );
}
