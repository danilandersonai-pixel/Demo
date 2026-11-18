/**
 * Производные цвета темы: считаются один раз на тему, а не в каждом кадре.
 * Горячий цикл рендера берёт готовые строки и меняет только globalAlpha.
 */
import { shipColors } from '../config';
import { mixColor, rgba } from '../math';
import type { Skin, Theme } from '../types';
import { hotColor } from './util';

export interface Palette {
  bg: string;
  /** Пол у горизонта и дымка над сеткой. */
  floorTop: string;
  /** Дымка горизонта (rgba-строки для градиента тумана). */
  fogStrong: string;
  fogMid: string;
  fogClear: string;
  cube: string;
  cubeHot: string;
  saw: string;
  sawHot: string;
  laser: string;
  laserHot: string;
  crystal: string;
  crystalHot: string;
  rare: string;
  rareHot: string;
  /** Подсветка прохода в лазерной стене. */
  gap: string;
  /** Тёмная «заливка тела» для твёрдых на вид объектов. */
  body: string;
}

const paletteCache = new WeakMap<Theme, Palette>();

export function paletteFor(theme: Theme): Palette {
  const cached = paletteCache.get(theme);
  if (cached) return cached;
  const c = theme.colors;
  const floorTop = mixColor(c.skyBottom, c.bg, 0.35);
  const palette: Palette = {
    bg: c.bg,
    floorTop,
    fogStrong: rgba(floorTop, 0.82),
    fogMid: rgba(floorTop, 0.32),
    fogClear: rgba(floorTop, 0),
    cube: c.cube,
    cubeHot: hotColor(c.cube),
    saw: c.saw,
    sawHot: hotColor(c.saw),
    laser: c.laser,
    laserHot: hotColor(c.laser),
    crystal: c.crystal,
    crystalHot: hotColor(c.crystal),
    rare: c.crystalRare,
    rareHot: hotColor(c.crystalRare),
    gap: c.accent3,
    body: mixColor(c.bg, c.skyBottom, 0.25),
  };
  paletteCache.set(theme, palette);
  return palette;
}

export interface ShipPalette {
  hull: string;
  hullHot: string;
  core: string;
  /** Цвет щита-призрака: корпус, разбавленный белым. */
  shield: string;
  flame: string;
}

let lastSkin: Skin | null = null;
let lastTheme: Theme | null = null;
let lastShip: ShipPalette | null = null;

/** Цвета корабля; кэш по паре (скин, тема) — shipColors() создаёт объект на каждый вызов. */
export function shipPaletteFor(skin: Skin, theme: Theme): ShipPalette {
  if (lastShip && lastSkin === skin && lastTheme === theme) return lastShip;
  const { hull, core } = shipColors(skin, theme);
  lastSkin = skin;
  lastTheme = theme;
  lastShip = {
    hull,
    hullHot: hotColor(hull),
    core,
    shield: mixColor(hull, '#ffffff', 0.35),
    flame: theme.colors.trail,
  };
  return lastShip;
}
