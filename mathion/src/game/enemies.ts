// Бестиарий: шаблоны врагов для охоты и 10 боссов Башни Испытаний.

import type { Element, Enemy, EnemyIconId, EnemyKind, Rng, TraitId } from '../types';
import { pick, uid } from './utils';

interface EnemyTemplate {
  id: string;
  name: string;
  title: string;
  kind: EnemyKind;
  icon: EnemyIconId;
  hp: number;
  shield: number;
  attack: number;
  attackTime: number;
  weakness: Element | null;
  resist: Element | null;
  traits: TraitId[];
}

/** Обитатели охотничьих угодий. Параметры указаны для 1-го уровня и масштабируются. */
export const HUNT_TEMPLATES: EnemyTemplate[] = [
  { id: 'rat', name: 'Счётная крыса', title: 'Грызёт единицы', kind: 'monster', icon: 'rat', hp: 55, shield: 0, attack: 7, attackTime: 13, weakness: 'fire', resist: null, traits: [] },
  { id: 'beetle', name: 'Жук-делитель', title: 'Панцирь из дробей', kind: 'monster', icon: 'bug', hp: 50, shield: 12, attack: 6, attackTime: 14, weakness: 'water', resist: 'earth', traits: [] },
  { id: 'snail', name: 'Улитка остатков', title: 'Медленная, но упрямая', kind: 'monster', icon: 'snail', hp: 75, shield: 0, attack: 5, attackTime: 16, weakness: 'earth', resist: 'water', traits: [] },
  { id: 'crow', name: 'Ворон-вычитатель', title: 'Крадёт цифры', kind: 'monster', icon: 'bird', hp: 45, shield: 0, attack: 9, attackTime: 11, weakness: 'water', resist: 'fire', traits: [] },
  { id: 'wisp', name: 'Блуждающий огонёк', title: 'Дух забытой задачи', kind: 'monster', icon: 'ghost', hp: 48, shield: 0, attack: 8, attackTime: 12, weakness: 'void', resist: 'earth', traits: [] },
  { id: 'brass_golem', name: 'Латунный голем', title: 'Механизм из шестерёнок', kind: 'golem', icon: 'golem', hp: 70, shield: 25, attack: 8, attackTime: 15, weakness: 'water', resist: 'fire', traits: [] },
  { id: 'anvil_golem', name: 'Голем-наковальня', title: 'Кованый страж кузни', kind: 'golem', icon: 'anvil', hp: 85, shield: 20, attack: 9, attackTime: 15, weakness: 'fire', resist: 'earth', traits: [] },
  { id: 'bone', name: 'Костяной счетовод', title: 'Считает до последнего', kind: 'monster', icon: 'skull', hp: 60, shield: 0, attack: 8, attackTime: 13, weakness: 'earth', resist: 'void', traits: [] },
];

/** Масштабирование характеристик врага от уровня. */
export function scaleHp(base: number, level: number): number {
  return Math.round(base * (1 + (level - 1) * 0.35));
}

export function scaleAttack(base: number, level: number): number {
  return Math.round(base * (1 + (level - 1) * 0.18));
}

function build(template: EnemyTemplate, level: number, overrides: Partial<Enemy> = {}): Enemy {
  const maxHp = overrides.maxHp ?? scaleHp(template.hp, level);
  const maxShield = overrides.maxShield ?? Math.round(template.shield * (1 + (level - 1) * 0.25));
  return {
    id: uid(),
    templateId: template.id,
    name: template.name,
    title: template.title,
    kind: template.kind,
    icon: template.icon,
    level,
    maxHp,
    hp: maxHp,
    shield: maxShield,
    maxShield,
    attack: overrides.attack ?? scaleAttack(template.attack, level),
    attackBonus: 0,
    attackTime: template.attackTime,
    weakness: template.weakness,
    resist: template.resist,
    traits: [...template.traits],
    enraged: false,
  };
}

export function createHuntEnemy(level: number, rng: Rng): Enemy {
  return build(pick(rng, HUNT_TEMPLATES), Math.max(1, level));
}

// ---------------------------------------------------------------------------
// Башня Испытаний
// ---------------------------------------------------------------------------

export interface FloorBoss extends EnemyTemplate {
  floor: number;
  level: number;
  /** Правило этажа — показывается игроку до боя. */
  rule: string;
  lore: string;
  firstClearGold: number;
}

export const TOWER: FloorBoss[] = [
  {
    floor: 1, level: 2, id: 'boss_counter', name: 'Каменный Счетовод', title: 'Страж подножия', kind: 'golem', icon: 'golem',
    hp: 230, shield: 20, attack: 10, attackTime: 14, weakness: 'fire', resist: 'earth', traits: [],
    rule: 'Без особых условий. Слаб к Огню, крепок к Земле.', lore: 'Первый экзамен каждого алхимика.', firstClearGold: 60,
  },
  {
    floor: 2, level: 4, id: 'boss_imp', name: 'Огненный Имп', title: 'Поджигатель черновиков', kind: 'boss', icon: 'flame',
    hp: 330, shield: 0, attack: 13, attackTime: 14, weakness: 'water', resist: 'fire', traits: ['heat'],
    rule: 'Жар: на каждый пример на 2 секунды меньше.', lore: 'Сжигает задачи, пока вы их читаете.', firstClearGold: 80,
  },
  {
    floor: 3, level: 6, id: 'boss_ice', name: 'Ледяной Голем', title: 'Хранитель инея', kind: 'golem', icon: 'snowflake',
    hp: 430, shield: 60, attack: 15, attackTime: 15, weakness: 'fire', resist: 'water', traits: ['frost_shield'],
    rule: 'Ледяной панцирь: каждая его атака восстанавливает 15 щита.', lore: 'Замерзает быстрее, чем вы считаете.', firstClearGold: 100,
  },
  {
    floor: 4, level: 8, id: 'boss_spider', name: 'Теневой Паук', title: 'Ткач ловушек', kind: 'boss', icon: 'biohazard',
    hp: 540, shield: 0, attack: 17, attackTime: 14, weakness: 'earth', resist: 'void', traits: ['poison'],
    rule: 'Яд: каждая его атака отравляет вас на 3 хода (по 4 урона за ход).', lore: 'Его паутина сплетена из остатков от деления.', firstClearGold: 120,
  },
  {
    floor: 5, level: 10, id: 'boss_twins', name: 'Близнецы Чётности', title: 'Двуединые судьи', kind: 'boss', icon: 'hexagon',
    hp: 650, shield: 30, attack: 19, attackTime: 15, weakness: 'void', resist: null, traits: ['even_only'],
    rule: 'Принимают только ответы, кратные двум: все примеры дают чётный результат, нечётный ввод — всегда ошибка.',
    lore: 'Они не терпят одиночества — даже у чисел.', firstClearGold: 150,
  },
  {
    floor: 6, level: 12, id: 'boss_minotaur', name: 'Механический Минотавр', title: 'Паровой таран', kind: 'golem', icon: 'axe',
    hp: 780, shield: 40, attack: 20, attackTime: 15, weakness: 'water', resist: 'earth', traits: ['rage'],
    rule: 'Ярость: каждая его атака сильнее предыдущей на 3.', lore: 'Чем дольше бой, тем горячее его котёл.', firstClearGold: 180,
  },
  {
    floor: 7, level: 14, id: 'boss_mirror', name: 'Зеркальный Маг', title: 'Отражатель формул', kind: 'boss', icon: 'eye',
    hp: 800, shield: 0, attack: 22, attackTime: 15, weakness: 'earth', resist: 'fire', traits: ['mirror'],
    rule: 'Отражение: 15% нанесённого урона возвращается к вам.', lore: 'Каждое ваше заклинание он видит дважды.', firstClearGold: 210,
  },
  {
    floor: 8, level: 16, id: 'boss_chrono', name: 'Хронофаг', title: 'Пожиратель секунд', kind: 'boss', icon: 'hourglass',
    hp: 1000, shield: 0, attack: 23, attackTime: 18, weakness: 'fire', resist: 'water', traits: ['chrono'],
    rule: 'Пожиратель времени: таймер вдвое короче, но ваш урон по нему ×1.3.', lore: 'Он ест мгновения, как другие едят хлеб.', firstClearGold: 240,
  },
  {
    floor: 9, level: 18, id: 'boss_necro', name: 'Некромант Дробей', title: 'Воскреситель остатков', kind: 'boss', icon: 'skull',
    hp: 1150, shield: 50, attack: 26, attackTime: 16, weakness: 'void', resist: 'earth', traits: ['regen', 'poison'],
    rule: 'Регенерация: каждая его атака лечит его на 5% здоровья. Атаки отравляют.', lore: 'Ошибки для него — источник силы.', firstClearGold: 280,
  },
  {
    floor: 10, level: 20, id: 'boss_archmage', name: 'Архимаг Пустоты', title: 'Властелин неизвестного', kind: 'boss', icon: 'orbit',
    hp: 1350, shield: 60, attack: 28, attackTime: 18, weakness: 'void', resist: null, traits: ['void_only', 'phase'],
    rule: 'Печать Пустоты: всё, кроме Магии Пустоты, наносит лишь 25% урона. На половине HP — вторая фаза: щит 100, атака +6.',
    lore: 'Последний вопрос Башни — всегда «чему равен x?».', firstClearGold: 400,
  },
];

export function getFloor(floor: number): FloorBoss {
  const boss = TOWER[floor - 1];
  if (!boss) throw new Error(`Нет этажа ${floor}`);
  return boss;
}

export function createFloorBoss(floor: number): Enemy {
  const boss = getFloor(floor);
  return build(boss, boss.level, { maxHp: boss.hp, maxShield: boss.shield, attack: boss.attack });
}

export const TRAIT_META: Record<TraitId, { name: string; description: string }> = {
  heat: { name: 'Жар', description: 'На каждый пример на 2 секунды меньше.' },
  frost_shield: { name: 'Ледяной панцирь', description: 'Каждая атака восстанавливает 15 щита.' },
  poison: { name: 'Яд', description: 'Атаки отравляют на 3 хода.' },
  even_only: { name: 'Чётность', description: 'Принимаются только чётные ответы.' },
  rage: { name: 'Ярость', description: 'Каждая атака на 3 сильнее предыдущей.' },
  mirror: { name: 'Отражение', description: '15% вашего урона возвращается к вам.' },
  chrono: { name: 'Пожиратель времени', description: 'Таймер вдвое короче, ваш урон ×1.3.' },
  regen: { name: 'Регенерация', description: 'Лечится на 5% при каждой атаке.' },
  void_only: { name: 'Печать Пустоты', description: 'Уязвим в полную силу только к Пустоте.' },
  phase: { name: 'Вторая фаза', description: 'На половине HP восстанавливает щит и усиливается.' },
};

export const POISON_DAMAGE = 4;
export const POISON_TURNS = 3;
export const FROST_SHIELD_REGEN = 15;
export const RAGE_STEP = 3;
export const MIRROR_RATIO = 0.15;
export const CHRONO_DAMAGE_BONUS = 1.3;
export const REGEN_RATIO_ENEMY = 0.05;
export const VOID_ONLY_PENALTY = 0.25;
export const PHASE_SHIELD = 100;
export const PHASE_ATTACK_BONUS = 6;
