/** Material items (physical objects on belts) and fluids. Index 0 is reserved for "none". */
export type ItemId =
  | 'iron_ore' | 'copper_ore' | 'silicon_ore' | 'stone' | 'rare_earth' | 'uranium_ore' | 'oil'
  | 'iron_plate' | 'copper_plate' | 'stone_brick' | 'steel' | 'gear' | 'copper_wire' | 'silicon_wafer'
  | 'plastic' | 'electrolyte' | 'battery' | 'microchip' | 'magnet' | 'memory_module' | 'tensor_chip'
  | 'uranium_fuel' | 'science_mech' | 'science_elec' | 'science_ai' | 'science_auto';

export interface ItemDef {
  id: ItemId;
  name: string;
  /** Short plural/genitive-friendly name for sentences. */
  short: string;
  color: number;
  fluid?: boolean;
  /** Shape used by the procedural item sprite. */
  shape: 'ore' | 'plate' | 'gear' | 'wire' | 'chip' | 'cell' | 'crystal' | 'drop' | 'brick' | 'pack' | 'module';
  desc: string;
}

export const ITEM_LIST: ItemDef[] = [
  { id: 'iron_ore', name: 'Железная руда', short: 'железная руда', color: 0x8f8a8c, shape: 'ore', desc: 'Добывается буром на железном месторождении.' },
  { id: 'copper_ore', name: 'Медная руда', short: 'медная руда', color: 0xd37c4f, shape: 'ore', desc: 'Добывается буром на медном месторождении.' },
  { id: 'silicon_ore', name: 'Кварцевый песок', short: 'кварцевый песок', color: 0xaeb7cb, shape: 'ore', desc: 'Сырьё для кремниевых пластин. Много в горах и пустынях.' },
  { id: 'stone', name: 'Камень', short: 'камень', color: 0x8a7f70, shape: 'ore', desc: 'Строительный камень, переплавляется в кирпич.' },
  { id: 'rare_earth', name: 'Редкоземы', short: 'редкоземы', color: 0x9096db, shape: 'crystal', desc: 'Фиолетовые кристаллы. Нужны для магнитов и тензорных чипов.' },
  { id: 'uranium_ore', name: 'Урановая руда', short: 'уран', color: 0xb6de4a, shape: 'crystal', desc: 'Далёкие горные месторождения. Топливо для реактора.' },
  { id: 'oil', name: 'Нефть', short: 'нефть', color: 0x1a222d, fluid: true, shape: 'drop', desc: 'Жидкость. Добывается буровой установкой и течёт по трубам.' },
  { id: 'iron_plate', name: 'Железная пластина', short: 'железные пластины', color: 0xb2abaf, shape: 'plate', desc: 'Базовый металл.' },
  { id: 'copper_plate', name: 'Медная пластина', short: 'медные пластины', color: 0xe08a55, shape: 'plate', desc: 'Проводящий металл.' },
  { id: 'stone_brick', name: 'Кирпич', short: 'кирпич', color: 0xa0674a, shape: 'brick', desc: 'Для печей и фундаментов.' },
  { id: 'steel', name: 'Сталь', short: 'сталь', color: 0x7f8c99, shape: 'plate', desc: 'Прочный сплав для серьёзных сооружений.' },
  { id: 'gear', name: 'Шестерня', short: 'шестерни', color: 0xa9a3a6, shape: 'gear', desc: 'Механический компонент.' },
  { id: 'copper_wire', name: 'Медный провод', short: 'медный провод', color: 0xf09a60, shape: 'wire', desc: 'Для электроники.' },
  { id: 'silicon_wafer', name: 'Кремниевая пластина', short: 'кремниевые пластины', color: 0x8fb4e0, shape: 'plate', desc: 'Основа микросхем.' },
  { id: 'plastic', name: 'Пластик', short: 'пластик', color: 0xe8eef2, shape: 'brick', desc: 'Из нефти на химзаводе.' },
  { id: 'electrolyte', name: 'Электролит', short: 'электролит', color: 0x5fd6b8, shape: 'cell', desc: 'Для аккумуляторов.' },
  { id: 'battery', name: 'Аккумулятор', short: 'аккумуляторы', color: 0x33c0a7, shape: 'cell', desc: 'Хранит энергию. Нужен дронам и исследованиям.' },
  { id: 'microchip', name: 'Микросхема', short: 'микросхемы', color: 0x32c6f4, shape: 'chip', desc: 'Сердце электроники.' },
  { id: 'magnet', name: 'Редкоземельный магнит', short: 'магниты', color: 0xa7abf0, shape: 'module', desc: 'Для тензорных чипов и моторов.' },
  { id: 'memory_module', name: 'Модуль памяти', short: 'модули памяти', color: 0x4976be, shape: 'module', desc: 'Увеличивает контекст ИИ, если установлен в AI Core или серверную.' },
  { id: 'tensor_chip', name: 'Тензорный ИИ-чип', short: 'тензорные чипы', color: 0x66d8ff, shape: 'chip', desc: 'Вычислительное сердце серверных.' },
  { id: 'uranium_fuel', name: 'Урановое топливо', short: 'урановое топливо', color: 0xd6ee80, shape: 'cell', desc: 'Топливо для ядерного реактора и пакетов «Автономия».' },
  { id: 'science_mech', name: 'Пакет «Механика»', short: 'пакеты «Механика»', color: 0xd37c4f, shape: 'pack', desc: 'Исследования: логистика, энергия, химия.' },
  { id: 'science_elec', name: 'Пакет «Электроника»', short: 'пакеты «Электроника»', color: 0x32c6f4, shape: 'pack', desc: 'Исследования: серверы, дроны, AI Core.' },
  { id: 'science_ai', name: 'Пакет «ИИ»', short: 'пакеты «ИИ»', color: 0x33c0a7, shape: 'pack', desc: 'Исследования: агенты, обучение, эра дронов.' },
  { id: 'science_auto', name: 'Пакет «Автономия»', short: 'пакеты «Автономия»', color: 0x9096db, shape: 'pack', desc: 'Исследования: колония и Шпиль.' },
];

export const ITEMS: Record<ItemId, ItemDef> = Object.fromEntries(ITEM_LIST.map((d) => [d.id, d])) as Record<ItemId, ItemDef>;

/** Numeric index for typed arrays: 1..N (0 = empty). */
export const ITEM_INDEX: Record<ItemId, number> = Object.fromEntries(ITEM_LIST.map((d, i) => [d.id, i + 1])) as Record<ItemId, number>;
export const ITEM_BY_INDEX: (ItemId | null)[] = [null, ...ITEM_LIST.map((d) => d.id)];

export function isItemId(s: string): s is ItemId {
  return s in ITEMS;
}

/** Raw resources that can be deposits on the map. Index is stored in World.res. */
export type ResourceId = 'iron_ore' | 'copper_ore' | 'silicon_ore' | 'stone' | 'rare_earth' | 'uranium_ore' | 'oil';
export const RESOURCE_LIST: ResourceId[] = ['iron_ore', 'copper_ore', 'silicon_ore', 'stone', 'rare_earth', 'uranium_ore', 'oil'];
/** World.res value → resource id (0 = none). */
export const RES_BY_CODE: (ResourceId | null)[] = [null, ...RESOURCE_LIST];
export const RES_CODE: Record<ResourceId, number> = Object.fromEntries(RESOURCE_LIST.map((r, i) => [r, i + 1])) as Record<ResourceId, number>;
export const RESOURCE_NAMES: Record<ResourceId, string> = {
  iron_ore: 'Железо',
  copper_ore: 'Медь',
  silicon_ore: 'Кремний',
  stone: 'Камень',
  rare_earth: 'Редкоземы',
  uranium_ore: 'Уран',
  oil: 'Нефть',
};
