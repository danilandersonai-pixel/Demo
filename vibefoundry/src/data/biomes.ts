import type { ResourceId } from './items';

export enum Biome {
  Deep = 0,
  Sea = 1,
  Lake = 2,
  Beach = 3,
  Meadow = 4,
  Plains = 5,
  Forest = 6,
  Hills = 7,
  Mountain = 8,
  Snow = 9,
  Tundra = 10,
  Desert = 11,
  Swamp = 12,
  Volcanic = 13,
  Crystal = 14,
}

export const BIOME_COUNT = 15;

export interface BiomeDef {
  id: Biome;
  name: string;
  water: boolean;
  /** Top color and 2 variants (0xRRGGBB). */
  top: [number, number, number];
  side: number;
  /** Minimap / strategic map color. */
  map: number;
  desc: string;
  recommend: string;
  /** Resource likelihood for the tile info panel. */
  hints: Partial<Record<ResourceId, 'Высокое' | 'Среднее' | 'Низкое'>>;
  /** Legend group for the strategic map filter. */
  legend: 'forest' | 'mountains' | 'desert' | 'tundra' | 'swamp' | 'water' | 'plains' | 'danger';
}

export const BIOMES: BiomeDef[] = [
  { id: Biome.Deep, name: 'Море', water: true, top: [0x05405e, 0x053d5a, 0x064463], side: 0x032c44, map: 0x0a3550, desc: 'Глубокая вода. Строить нельзя.', recommend: 'Используйте воду для охлаждения центров данных на берегу.', hints: {}, legend: 'water' },
  { id: Biome.Sea, name: 'Мелководье', water: true, top: [0x0b5a78, 0x0e6180, 0x0a5572], side: 0x053d5a, map: 0x0f5a78, desc: 'Прибрежная вода. Строить нельзя.', recommend: 'Хорошее место для охлаждения дата-центров.', hints: {}, legend: 'water' },
  { id: Biome.Lake, name: 'Озеро', water: true, top: [0x0b4d70, 0x0d5478, 0x0a486a], side: 0x073a58, map: 0x0e5a80, desc: 'Пресная вода: озёра и реки.', recommend: 'Стройте дата-центры у воды — охлаждение бесплатно.', hints: {}, legend: 'water' },
  { id: Biome.Beach, name: 'Побережье', water: false, top: [0xc9ad72, 0xd2b67c, 0xbfa368], side: 0x8a6e42, map: 0xc8aa6c, desc: 'Песчаный берег. Кварцевый песок встречается часто.', recommend: 'Подходит для складов и логистики вдоль берега.', hints: { silicon_ore: 'Среднее' }, legend: 'desert' },
  { id: Biome.Meadow, name: 'Луг', water: false, top: [0x6e8a2e, 0x7a9434, 0x647f2a], side: 0x5a4630, map: 0x5f8a2c, desc: 'Ровная травянистая земля. Идеально для застройки.', recommend: 'Лучшее место для основной фабрики.', hints: { iron_ore: 'Среднее', copper_ore: 'Среднее', stone: 'Низкое' }, legend: 'plains' },
  { id: Biome.Plains, name: 'Равнина', water: false, top: [0x9a8a34, 0xa3923a, 0x8f802e], side: 0x5e4a2e, map: 0x9a8a3a, desc: 'Сухая степь с редкими кустами.', recommend: 'Много места для солнечных полей.', hints: { iron_ore: 'Среднее', stone: 'Среднее' }, legend: 'plains' },
  { id: Biome.Forest, name: 'Лес', water: false, top: [0x2f5a1e, 0x34621f, 0x2a521b], side: 0x3e3222, map: 0x2d621b, desc: 'Густой хвойный лес. Дроны расчищают деревья при стройке.', recommend: 'Расчистите место или стройте по краю леса.', hints: { copper_ore: 'Среднее', iron_ore: 'Низкое' }, legend: 'forest' },
  { id: Biome.Hills, name: 'Холмы', water: false, top: [0x7c8034, 0x72782f, 0x86883a], side: 0x56482f, map: 0x7c8034, desc: 'Пологие холмы. Железо и медь близко к поверхности.', recommend: 'Хорошее место для рудников.', hints: { iron_ore: 'Высокое', copper_ore: 'Высокое', stone: 'Среднее' }, legend: 'mountains' },
  { id: Biome.Mountain, name: 'Горы', water: false, top: [0x6e6c68, 0x7a7874, 0x62605c], side: 0x48443e, map: 0x81817e, desc: 'Высокий рельеф. Богатые залежи кремния и редкоземельных металлов.', recommend: 'Рекомендуется строительство складов и дронов-экспедиций.', hints: { silicon_ore: 'Высокое', rare_earth: 'Среднее', stone: 'Высокое', uranium_ore: 'Низкое' }, legend: 'mountains' },
  { id: Biome.Snow, name: 'Снежные вершины', water: false, top: [0xc8d4dc, 0xd6e0e6, 0xbcc8d2], side: 0x8c9aa4, map: 0xdce6ee, desc: 'Холодные пики. Здесь прячется уран.', recommend: 'Уран — далеко и высоко: нужны дроны и опоры ЛЭП.', hints: { uranium_ore: 'Среднее', stone: 'Среднее' }, legend: 'tundra' },
  { id: Biome.Tundra, name: 'Тундра', water: false, top: [0x6d825f, 0x788c6a, 0x647858], side: 0x4c5244, map: 0x7d9270, desc: 'Холодная равнина с мхом и редкими елями.', recommend: 'Спокойное место для дата-центров.', hints: { iron_ore: 'Среднее', stone: 'Среднее' }, legend: 'tundra' },
  { id: Biome.Desert, name: 'Пустыня', water: false, top: [0xb8894a, 0xc4955a, 0xaa7c40], side: 0x7a5a30, map: 0xc08a48, desc: 'Жарко и сухо. Кварцевый песок и нефть.', recommend: 'Идеально для солнечных полей и добычи песка.', hints: { silicon_ore: 'Высокое', oil: 'Среднее', stone: 'Низкое' }, legend: 'desert' },
  { id: Biome.Swamp, name: 'Болото', water: false, top: [0x3e5a4c, 0x445e44, 0x385450], side: 0x2e3a30, map: 0x486452, desc: 'Топкая низина. Нефть близко к поверхности.', recommend: 'Ставьте буровые установки на нефтяные пятна.', hints: { oil: 'Высокое' }, legend: 'swamp' },
  { id: Biome.Volcanic, name: 'Красная зона', water: false, top: [0x4a2a22, 0x55302a, 0x40241e], side: 0x2e1a16, map: 0x8a3322, desc: 'Раскалённая земля. Здесь гнездятся сбойные автоматы.', recommend: 'Опасно! Сначала турели и боевые дроны.', hints: { stone: 'Высокое', rare_earth: 'Низкое' }, legend: 'danger' },
  { id: Biome.Crystal, name: 'Кристаллическая пустошь', water: false, top: [0x3c3458, 0x463c66, 0x342e4e], side: 0x221e36, map: 0x5c4c9a, desc: 'Фиолетовые кристаллы редкоземов выходят на поверхность.', recommend: 'Главный источник редкоземов для магнитов и тензорных чипов.', hints: { rare_earth: 'Высокое' }, legend: 'mountains' },
];

export function isWater(b: number): boolean {
  return b <= Biome.Lake;
}

/** Decoration codes stored in World.deco. */
export enum Deco {
  None = 0,
  Pine = 1,
  Pine2 = 2,
  Oak = 3,
  Bush = 4,
  Rock = 5,
  Boulder = 6,
  Crystal = 7,
  Reed = 8,
  Cactus = 9,
  SnowPine = 10,
  Lava = 11,
}
