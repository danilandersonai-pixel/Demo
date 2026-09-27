import type { Stack, MachineClass } from './recipes';

export type BuildingType =
  | 'hq' | 'belt' | 'underground' | 'splitter' | 'inserter' | 'pipe' | 'storage' | 'pole' | 'big_pole'
  | 'drill' | 'pumpjack'
  | 'smelter' | 'assembler' | 'assembler2' | 'chem' | 'lab'
  | 'power_plant' | 'solar' | 'accumulator' | 'reactor'
  | 'aicore' | 'server' | 'datacenter' | 'inference' | 'datacollector' | 'training' | 'ci'
  | 'droneport' | 'radar' | 'turret'
  | 'spire';

export type BuildCategory = 'logistics' | 'mining' | 'production' | 'power' | 'ai' | 'drones' | 'colony';

export const CATEGORY_NAMES: Record<BuildCategory, string> = {
  logistics: 'Логистика',
  mining: 'Добыча',
  production: 'Производство',
  power: 'Энергия',
  ai: 'ИИ',
  drones: 'Дроны и оборона',
  colony: 'Колония',
};

export interface BuildingDef {
  id: BuildingType;
  name: string;
  desc: string;
  w: number;
  h: number;
  cost: Stack[];
  category: BuildCategory;
  /** kW drawn while working. 0 = not an electric consumer. */
  power: number;
  /** kW drawn while idle. */
  idle: number;
  hp: number;
  /** Tech required. */
  unlock?: string;
  /** Can be rotated with R (affects IO direction). */
  rotatable?: boolean;
  /** Machine class for recipe-based buildings. */
  machine?: MachineClass;
  speed?: number;
  /** Power generation in kW. */
  gen?: number;
  /** Electric pole: wire reach (tiles) and supply margin around footprint (tiles). */
  poleReach?: number;
  poleSupply?: number;
  /** Item storage capacity (total items). */
  storage?: number;
  /** Connects to pipe networks. */
  fluid?: boolean;
  /** Pollution per minute while working. */
  pollution?: number;
  /** Build time for construction drones, seconds. */
  buildTime?: number;
  /** Hidden from the build menu (HQ). */
  hidden?: boolean;
}

const D = (d: BuildingDef) => d;

export const BUILDING_LIST: BuildingDef[] = [
  D({ id: 'hq', name: 'База (HQ)', desc: 'Сердце колонии: склад, 1 MW энергии, 2 строительных дрона, терминал ИИ. Уничтожить нельзя.', w: 5, h: 5, cost: [], category: 'logistics', power: 0, idle: 0, hp: 5000, gen: 1000, poleReach: 10, poleSupply: 5, storage: 100000, hidden: true }),
  // Logistics
  D({ id: 'belt', name: 'Конвейер', desc: 'Везёт предметы. Протяните линию мышью. R — поворот.', w: 1, h: 1, cost: [{ item: 'iron_plate', n: 1 }], category: 'logistics', power: 0, idle: 0, hp: 100, rotatable: true, buildTime: 0.2 }),
  D({ id: 'underground', name: 'Подземный конвейер', desc: 'Проводит ленту под постройками до 5 тайлов. Ставьте вход и выход в одном направлении.', w: 1, h: 1, cost: [{ item: 'iron_plate', n: 5 }, { item: 'gear', n: 2 }], category: 'logistics', power: 0, idle: 0, hp: 150, rotatable: true, unlock: 'logistics2' }),
  D({ id: 'splitter', name: 'Распределитель', desc: 'Делит поток на 3 выхода (вперёд, влево, вправо). Фильтры задаются скриптами через route().', w: 1, h: 1, cost: [{ item: 'iron_plate', n: 5 }, { item: 'gear', n: 3 }, { item: 'copper_plate', n: 2 }], category: 'logistics', power: 0, idle: 0, hp: 150, rotatable: true, unlock: 'logistics' }),
  D({ id: 'inserter', name: 'Робот-манипулятор', desc: 'Берёт предмет сзади и кладёт вперёд. Кладёт только то, что нужно зданию.', w: 1, h: 1, cost: [{ item: 'iron_plate', n: 2 }, { item: 'gear', n: 1 }, { item: 'copper_plate', n: 1 }], category: 'logistics', power: 5, idle: 0.4, hp: 80, rotatable: true, buildTime: 0.3 }),
  D({ id: 'pipe', name: 'Труба', desc: 'Соединяет буровые, химзаводы и электростанции в жидкостную сеть.', w: 1, h: 1, cost: [{ item: 'iron_plate', n: 1 }], category: 'logistics', power: 0, idle: 0, hp: 100, buildTime: 0.2 }),
  D({ id: 'storage', name: 'Склад', desc: 'Хранит до 2400 предметов. Строительные дроны берут материалы и со складов.', w: 2, h: 2, cost: [{ item: 'iron_plate', n: 10 }, { item: 'stone_brick', n: 4 }], category: 'logistics', power: 0, idle: 0, hp: 400, storage: 2400 }),
  D({ id: 'pole', name: 'Столб ЛЭП', desc: 'Соединяется со столбами в радиусе 8 тайлов и питает здания в квадрате 5×5.', w: 1, h: 1, cost: [{ item: 'iron_plate', n: 1 }, { item: 'copper_plate', n: 2 }], category: 'logistics', power: 0, idle: 0, hp: 80, poleReach: 8, poleSupply: 2, buildTime: 0.3 }),
  D({ id: 'big_pole', name: 'Опора ЛЭП', desc: 'Дальняя линия: радиус соединения 24 тайла, питает только соседние тайлы.', w: 1, h: 1, cost: [{ item: 'steel', n: 4 }, { item: 'copper_plate', n: 6 }], category: 'logistics', power: 0, idle: 0, hp: 200, poleReach: 24, poleSupply: 1, unlock: 'power_lines' }),
  // Mining
  D({ id: 'drill', name: 'Сборщик ресурсов', desc: 'Бур 2×2. Ставится на месторождение, выдаёт руду на тайл перед собой (стрелка).', w: 2, h: 2, cost: [{ item: 'iron_plate', n: 10 }, { item: 'gear', n: 5 }], category: 'mining', power: 60, idle: 2, hp: 300, rotatable: true, speed: 0.5, pollution: 10 }),
  D({ id: 'pumpjack', name: 'Буровая установка', desc: 'Качает нефть с месторождения в трубы (10 ед./с).', w: 2, h: 2, cost: [{ item: 'iron_plate', n: 15 }, { item: 'gear', n: 10 }, { item: 'stone_brick', n: 5 }], category: 'mining', power: 90, idle: 2, hp: 300, fluid: true, unlock: 'oil_power', pollution: 10 }),
  // Production
  D({ id: 'smelter', name: 'Плавильня', desc: 'Электропечь. Сама выбирает рецепт по первому входу: руда → пластины, песок → кремний, железо → сталь.', w: 2, h: 2, cost: [{ item: 'stone_brick', n: 8 }, { item: 'iron_plate', n: 4 }], category: 'production', power: 90, idle: 3, hp: 350, machine: 'smelter', speed: 1, pollution: 4 }),
  D({ id: 'assembler', name: 'Сборочный цех', desc: 'Собирает детали по выбранному рецепту. Входы и выходы — через манипуляторы.', w: 3, h: 3, cost: [{ item: 'iron_plate', n: 9 }, { item: 'gear', n: 5 }, { item: 'copper_plate', n: 3 }], category: 'production', power: 75, idle: 2.5, hp: 400, machine: 'assembler', speed: 0.75, pollution: 2 }),
  D({ id: 'assembler2', name: 'Сборочный цех II', desc: 'Быстрее (×1.25) и умеет тензорные ИИ-чипы.', w: 3, h: 3, cost: [{ item: 'steel', n: 4 }, { item: 'gear', n: 10 }, { item: 'microchip', n: 4 }, { item: 'magnet', n: 2 }], category: 'production', power: 150, idle: 5, hp: 450, machine: 'assembler2', speed: 1.25, unlock: 'assembler2', pollution: 2 }),
  D({ id: 'chem', name: 'Химический завод', desc: 'Нефть по трубам → пластик, электролит, аккумуляторы, урановое топливо.', w: 3, h: 3, cost: [{ item: 'steel', n: 5 }, { item: 'gear', n: 5 }, { item: 'iron_plate', n: 10 }], category: 'production', power: 210, idle: 7, hp: 400, machine: 'chem', speed: 1, fluid: true, unlock: 'oil_processing', pollution: 4 }),
  D({ id: 'lab', name: 'Исследовательская лаборатория', desc: 'Изучает технологии, потребляя пакеты исследований.', w: 3, h: 3, cost: [{ item: 'iron_plate', n: 10 }, { item: 'gear', n: 10 }, { item: 'copper_plate', n: 10 }], category: 'production', power: 60, idle: 2, hp: 300, speed: 1 }),
  // Power
  D({ id: 'power_plant', name: 'Электростанция', desc: 'Нефтяная ТЭС: 5 MW, жжёт нефть из труб пропорционально нагрузке.', w: 3, h: 3, cost: [{ item: 'iron_plate', n: 20 }, { item: 'gear', n: 10 }, { item: 'stone_brick', n: 20 }], category: 'power', power: 0, idle: 0, hp: 500, gen: 5000, fluid: true, unlock: 'oil_power', pollution: 20 }),
  D({ id: 'solar', name: 'Солнечное поле', desc: 'До 0.6 MW днём, ноль ночью. Дружите с аккумуляторами.', w: 3, h: 3, cost: [{ item: 'steel', n: 5 }, { item: 'silicon_wafer', n: 10 }, { item: 'copper_plate', n: 5 }], category: 'power', power: 0, idle: 0, hp: 250, gen: 600, unlock: 'solar' }),
  D({ id: 'accumulator', name: 'Аккумуляторная станция', desc: 'Хранит 5 MJ, отдаёт до 0.3 MW при дефиците.', w: 2, h: 2, cost: [{ item: 'iron_plate', n: 2 }, { item: 'battery', n: 5 }], category: 'power', power: 0, idle: 0, hp: 250, unlock: 'accumulators' }),
  D({ id: 'reactor', name: 'Ядерный реактор', desc: '40 MW. Сжигает 1 урановое топливо за 60 с (подавайте манипулятором).', w: 5, h: 5, cost: [{ item: 'steel', n: 200 }, { item: 'microchip', n: 100 }, { item: 'stone_brick', n: 200 }], category: 'power', power: 0, idle: 0, hp: 1500, gen: 40000, unlock: 'nuclear' }),
  // AI
  D({ id: 'aicore', name: 'AI Core', desc: 'Ядро ИИ: найм агентов, +8k контекста, слоты под 20 модулей памяти, немного вычислений.', w: 4, h: 4, cost: [{ item: 'steel', n: 20 }, { item: 'microchip', n: 20 }, { item: 'battery', n: 10 }], category: 'ai', power: 1500, idle: 100, hp: 1200, unlock: 'ai_core' }),
  D({ id: 'server', name: 'Серверная (AI)', desc: 'Производит вычисления (12/с) при 2 MW. 4 слота модулей памяти.', w: 2, h: 2, cost: [{ item: 'steel', n: 10 }, { item: 'tensor_chip', n: 4 }, { item: 'microchip', n: 10 }], category: 'ai', power: 2000, idle: 50, hp: 400, unlock: 'servers' }),
  D({ id: 'datacenter', name: 'Центр данных', desc: 'Кластер 6×6: 150 вычислений/с при 12 MW. Нужна вода в 4 тайлах для охлаждения, иначе 40 %.', w: 6, h: 6, cost: [{ item: 'steel', n: 100 }, { item: 'tensor_chip', n: 40 }, { item: 'microchip', n: 100 }, { item: 'stone_brick', n: 100 }], category: 'ai', power: 12000, idle: 300, hp: 2500, unlock: 'datacenter' }),
  D({ id: 'inference', name: 'Инференс-узел', desc: 'Превращает вычисления в токены: 4 вычисл./с → 3 токена/с.', w: 2, h: 2, cost: [{ item: 'microchip', n: 10 }, { item: 'steel', n: 5 }, { item: 'copper_wire', n: 20 }], category: 'ai', power: 500, idle: 20, hp: 300, unlock: 'inference' }),
  D({ id: 'datacollector', name: 'Сборщик данных', desc: 'Логирует производство в радиусе 12 тайлов → данные для обучения.', w: 2, h: 2, cost: [{ item: 'microchip', n: 5 }, { item: 'iron_plate', n: 10 }, { item: 'copper_wire', n: 10 }], category: 'ai', power: 200, idle: 10, hp: 250, unlock: 'data_collection' }),
  D({ id: 'training', name: 'Кластер обучения', desc: 'Вычисления 25/с + данные 1/с → веса модели. Новая версия модели = меньше галлюцинаций.', w: 4, h: 4, cost: [{ item: 'steel', n: 50 }, { item: 'tensor_chip', n: 10 }, { item: 'memory_module', n: 10 }], category: 'ai', power: 5000, idle: 100, hp: 1200, unlock: 'training' }),
  D({ id: 'ci', name: 'CI-станция', desc: 'Постоянно проверяет тесты производства. Скрипты с зелёными тестами не копят техдолг.', w: 2, h: 2, cost: [{ item: 'microchip', n: 10 }, { item: 'steel', n: 10 }], category: 'ai', power: 100, idle: 10, hp: 300, unlock: 'ci' }),
  // Drones & defence
  D({ id: 'droneport', name: 'Дрон-порт', desc: 'База дронов: радиус 30 тайлов, собирает и заряжает дронов.', w: 3, h: 3, cost: [{ item: 'steel', n: 10 }, { item: 'microchip', n: 10 }, { item: 'battery', n: 10 }, { item: 'gear', n: 20 }], category: 'drones', power: 400, idle: 20, hp: 600, unlock: 'droneport' }),
  D({ id: 'radar', name: 'Радар', desc: 'Открывает туман войны в радиусе 20, постепенно расширяя до 48.', w: 2, h: 2, cost: [{ item: 'iron_plate', n: 10 }, { item: 'gear', n: 5 }, { item: 'copper_plate', n: 5 }], category: 'drones', power: 100, idle: 100, hp: 250, unlock: 'radar' }),
  D({ id: 'turret', name: 'Турель', desc: 'Лазерная турель: радиус 12, работает от сети.', w: 2, h: 2, cost: [{ item: 'steel', n: 10 }, { item: 'gear', n: 10 }, { item: 'microchip', n: 5 }], category: 'drones', power: 200, idle: 5, hp: 600, unlock: 'turrets' }),
  // Colony
  D({ id: 'spire', name: 'Шпиль Колонии', desc: 'Финальное мегасооружение. Постройте и удерживайте автономию ≥ 90 % 10 минут.', w: 5, h: 5, cost: [{ item: 'steel', n: 400 }, { item: 'tensor_chip', n: 80 }, { item: 'memory_module', n: 80 }, { item: 'microchip', n: 200 }, { item: 'uranium_fuel', n: 20 }], category: 'colony', power: 20000, idle: 500, hp: 5000, unlock: 'colony_spire' }),
];

export const BUILDINGS: Record<BuildingType, BuildingDef> = Object.fromEntries(BUILDING_LIST.map((b) => [b.id, b])) as Record<BuildingType, BuildingDef>;

/** Types that take part in "all" group (controllable production/AI consumers). */
export const CONTROLLABLE: ReadonlySet<BuildingType> = new Set<BuildingType>([
  'drill', 'pumpjack', 'smelter', 'assembler', 'assembler2', 'chem', 'lab', 'server', 'datacenter', 'inference',
  'datacollector', 'training', 'radar', 'aicore', 'ci', 'droneport', 'turret', 'spire',
]);

/** Belt-like buildings that live in BeltStore. */
export const BELTLIKE: ReadonlySet<BuildingType> = new Set<BuildingType>(['belt', 'underground', 'splitter']);

/** Buildings accepting any item directly from belts/inserters (sinks). */
export const STORAGE_TYPES: ReadonlySet<BuildingType> = new Set<BuildingType>(['hq', 'storage']);

/** Russian aliases for group resolution and the intent engine. */
export const BUILDING_ALIASES: Record<string, BuildingType> = {
  smelter: 'smelter', smelters: 'smelter', furnace: 'smelter', furnaces: 'smelter',
  assembler: 'assembler', assemblers: 'assembler', assembler2: 'assembler2',
  chem: 'chem', chem_plant: 'chem', chemical: 'chem',
  drill: 'drill', drills: 'drill', miner: 'drill', miners: 'drill',
  pumpjack: 'pumpjack', lab: 'lab', labs: 'lab',
  server: 'server', servers: 'server', datacenter: 'datacenter', datacenters: 'datacenter',
  inference: 'inference', datacollector: 'datacollector', training: 'training',
  radar: 'radar', radars: 'radar', turret: 'turret', turrets: 'turret', droneport: 'droneport',
  aicore: 'aicore', ci: 'ci', spire: 'spire', power_plant: 'power_plant', solar: 'solar',
  accumulator: 'accumulator', reactor: 'reactor', storage: 'storage', inserter: 'inserter', inserters: 'inserter',
};
