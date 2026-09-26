import type { ItemId } from './items';

export type PackId = 'science_mech' | 'science_elec' | 'science_ai' | 'science_auto';

export interface TechEffects {
  beltSpeed?: number;
  inserterSpeed?: number;
  miningProd?: number;
  craftSpeed?: number;
  hallucination?: number;
  context?: number;
  droneSpeed?: number;
}

export interface TechDef {
  id: string;
  name: string;
  desc: string;
  packs: PackId[];
  count: number;
  /** Seconds per unit in one lab. */
  time: number;
  prereq: string[];
  effects?: TechEffects;
  /** Human-readable list of unlocks (buildings/recipes resolved automatically in UI). */
  note?: string;
  branch: 'logistics' | 'energy' | 'production' | 'ai' | 'agents' | 'drones' | 'colony';
}

const M: PackId[] = ['science_mech'];
const ME: PackId[] = ['science_mech', 'science_elec'];
const EA: PackId[] = ['science_elec', 'science_ai'];
const AU: PackId[] = ['science_ai', 'science_auto'];

export const TECH_LIST: TechDef[] = [
  // --- Mechanics ---------------------------------------------------------
  { id: 'radar', name: 'Радары', desc: 'Радар открывает туман войны вокруг себя.', packs: M, count: 10, time: 8, prereq: [], branch: 'logistics' },
  { id: 'logistics', name: 'Логистика', desc: 'Распределители: делите потоки, настраивайте фильтры скриптами.', packs: M, count: 15, time: 8, prereq: [], branch: 'logistics' },
  { id: 'oil_power', name: 'Нефтяная энергетика', desc: 'Буровая установка и нефтяная электростанция на 5 MW.', packs: M, count: 20, time: 10, prereq: [], branch: 'energy' },
  { id: 'steel', name: 'Сталь', desc: 'Плавильня превращает железные пластины в сталь.', packs: M, count: 20, time: 10, prereq: [], branch: 'production' },
  { id: 'silicon', name: 'Кремний', desc: 'Плавильня делает кремниевые пластины из кварцевого песка.', packs: M, count: 15, time: 10, prereq: [], branch: 'production' },
  { id: 'fast_inserters', name: 'Быстрые манипуляторы', desc: 'Манипуляторы работают на 50 % быстрее.', packs: M, count: 30, time: 10, prereq: ['logistics'], effects: { inserterSpeed: 0.5 }, branch: 'logistics' },
  { id: 'mining_productivity', name: 'Производительность бурения', desc: 'Буры добывают на 30 % быстрее.', packs: M, count: 40, time: 12, prereq: ['steel'], effects: { miningProd: 0.3 }, branch: 'production' },
  { id: 'oil_processing', name: 'Нефтехимия', desc: 'Химический завод и пластик из нефти.', packs: M, count: 30, time: 12, prereq: ['oil_power', 'steel'], branch: 'production' },
  { id: 'batteries', name: 'Аккумуляторы', desc: 'Электролит и аккумуляторы на химзаводе.', packs: M, count: 40, time: 12, prereq: ['oil_processing'], branch: 'energy' },
  { id: 'electronics', name: 'Электроника', desc: 'Микросхемы и пакет «Электроника».', packs: M, count: 50, time: 12, prereq: ['silicon', 'oil_processing'], branch: 'production' },
  { id: 'logistics2', name: 'Подземные конвейеры', desc: 'Проводите ленты под постройками до 5 тайлов.', packs: M, count: 40, time: 12, prereq: ['logistics'], branch: 'logistics' },
  { id: 'blueprints', name: 'Чертежи', desc: 'Копирование областей фабрики и вставка призраками (Ctrl+C / Ctrl+V).', packs: M, count: 30, time: 10, prereq: ['logistics'], branch: 'logistics' },
  { id: 'power_lines', name: 'Опоры ЛЭП', desc: 'Дальние линии электропередачи на 24 тайла.', packs: M, count: 30, time: 12, prereq: ['steel'], branch: 'energy' },
  // --- Electronics ---------------------------------------------------------
  { id: 'fast_belts', name: 'Скоростные конвейеры', desc: 'Все ленты ездят на 75 % быстрее.', packs: ME, count: 40, time: 15, prereq: ['logistics2', 'electronics'], effects: { beltSpeed: 0.75 }, branch: 'logistics' },
  { id: 'accumulators', name: 'Аккумуляторные станции', desc: 'Запасайте энергию на ночь и пики нагрузки.', packs: ME, count: 30, time: 15, prereq: ['batteries', 'electronics'], branch: 'energy' },
  { id: 'solar', name: 'Солнечная энергия', desc: 'Солнечные поля: бесплатная энергия днём.', packs: ME, count: 40, time: 15, prereq: ['electronics'], branch: 'energy' },
  { id: 'inference', name: 'Инференс', desc: 'Инференс-узел превращает вычисления в токены.', packs: ME, count: 30, time: 15, prereq: ['electronics'], branch: 'ai' },
  { id: 'ai_core', name: 'Ядро ИИ', desc: 'AI Core: найм агентов, память, постоянные скрипты. Открывает эру «AI Core».', packs: ME, count: 50, time: 15, prereq: ['inference', 'batteries'], branch: 'ai' },
  { id: 'memory', name: 'Модули памяти', desc: 'Модули памяти увеличивают контекст агентов.', packs: ME, count: 40, time: 15, prereq: ['electronics'], branch: 'ai' },
  { id: 'data_collection', name: 'Сбор данных', desc: 'Сборщик данных логирует производство → данные для обучения.', packs: ME, count: 30, time: 15, prereq: ['ai_core'], branch: 'ai' },
  { id: 'rare_earth', name: 'Редкоземы', desc: 'Добыча редкоземов и магниты.', packs: ME, count: 40, time: 15, prereq: ['electronics'], branch: 'production' },
  { id: 'assembler2', name: 'Сборочный цех II', desc: 'Быстрый сборщик, умеет тензорные чипы.', packs: ME, count: 50, time: 15, prereq: ['rare_earth'], branch: 'production' },
  { id: 'tensor', name: 'Тензорные чипы', desc: 'Вычислительные ИИ-чипы для серверных.', packs: ME, count: 50, time: 18, prereq: ['assembler2', 'memory'], branch: 'production' },
  { id: 'servers', name: 'Серверные', desc: 'Серверная (AI): вычисления для агентов и обучения.', packs: ME, count: 50, time: 18, prereq: ['tensor', 'ai_core'], branch: 'ai' },
  { id: 'agent_coder', name: 'Агент Coder', desc: 'Нанимайте Coder: пишет и настраивает FactoryScript.', packs: ME, count: 20, time: 12, prereq: ['ai_core'], branch: 'agents' },
  { id: 'agent_debugger', name: 'Агент Debugger', desc: 'Debugger сканирует фабрику и находит баги.', packs: ME, count: 30, time: 12, prereq: ['agent_coder'], branch: 'agents' },
  { id: 'agent_optimizer', name: 'Агент Optimizer', desc: 'Optimizer ищет узкие места и рефакторит техдолг.', packs: ME, count: 40, time: 15, prereq: ['agent_debugger'], branch: 'agents' },
  { id: 'sandbox', name: 'Песочница', desc: 'Прогон изменений на клоне фабрики с прогнозом.', packs: ME, count: 30, time: 12, prereq: ['ai_core'], branch: 'agents' },
  { id: 'ci', name: 'CI-станция', desc: 'Тесты производства: скрипты с зелёными тестами не копят техдолг.', packs: ME, count: 40, time: 15, prereq: ['sandbox'], branch: 'agents' },
  { id: 'droneport', name: 'Дрон-порты', desc: 'Дрон-порт расширяет зону строительства и собирает дронов.', packs: ME, count: 40, time: 15, prereq: ['batteries', 'electronics'], branch: 'drones' },
  { id: 'turrets', name: 'Турели', desc: 'Лазерные турели против сбойных автоматов.', packs: ME, count: 30, time: 12, prereq: ['steel', 'electronics'], branch: 'drones' },
  // --- AI ------------------------------------------------------------------
  { id: 'ai_science', name: 'Пакет «ИИ»', desc: 'Тензорный чип + данные для обучения → пакет «ИИ».', packs: ME, count: 50, time: 18, prereq: ['tensor', 'data_collection'], branch: 'ai' },
  { id: 'training', name: 'Обучение моделей', desc: 'Кластер обучения: вычисления + данные → веса модели.', packs: EA, count: 40, time: 20, prereq: ['ai_science', 'servers'], branch: 'ai' },
  { id: 'autonomous_drones', name: 'Автономные дроны', desc: 'Агенты получают тело. Открывает эру «Дроны».', packs: EA, count: 50, time: 20, prereq: ['droneport', 'training'], branch: 'drones' },
  { id: 'drones_worker', name: 'Рабочие дроны', desc: 'Дроны-разведчики: экспедиции к точкам «?».', packs: EA, count: 20, time: 15, prereq: ['autonomous_drones'], branch: 'drones' },
  { id: 'drones_logistic', name: 'Логистические дроны', desc: 'Возят предметы со складов в голодные цеха.', packs: EA, count: 30, time: 15, prereq: ['autonomous_drones'], branch: 'drones' },
  { id: 'drones_engineer', name: 'Инженеры-роботы', desc: 'Чинят повреждённые здания.', packs: EA, count: 30, time: 15, prereq: ['autonomous_drones'], branch: 'drones' },
  { id: 'drones_combat', name: 'Боевые дроны', desc: 'Патрулируют и защищают фабрику.', packs: EA, count: 40, time: 18, prereq: ['autonomous_drones', 'turrets'], branch: 'drones' },
  { id: 'agent_architect', name: 'Агент Architect', desc: 'Architect рассчитывает линии и ставит чертежи-призраки.', packs: EA, count: 40, time: 18, prereq: ['autonomous_drones', 'blueprints'], branch: 'agents' },
  { id: 'hallucination_1', name: 'Снижение галлюцинаций I', desc: 'Шанс багов в коде агентов −25 %.', packs: EA, count: 40, time: 20, prereq: ['training'], effects: { hallucination: 0.25 }, branch: 'agents' },
  { id: 'context_compression', name: 'Сжатие контекста', desc: 'Ёмкость контекста ×1.5.', packs: EA, count: 40, time: 20, prereq: ['memory', 'training'], effects: { context: 0.5 }, branch: 'ai' },
  { id: 'datacenter', name: 'Центры данных', desc: 'Кластер 6×6: 150 вычислений/с.', packs: EA, count: 60, time: 20, prereq: ['servers', 'training'], branch: 'ai' },
  { id: 'uranium', name: 'Урановая обработка', desc: 'Добыча урана и урановое топливо.', packs: EA, count: 40, time: 20, prereq: ['autonomous_drones'], branch: 'energy' },
  { id: 'nuclear', name: 'Ядерная энергетика', desc: 'Реактор на 40 MW.', packs: EA, count: 60, time: 22, prereq: ['uranium'], branch: 'energy' },
  { id: 'agent_orchestrator', name: 'Агент Orchestrator', desc: 'Orchestrator раскладывает большие цели на подзадачи.', packs: EA, count: 50, time: 20, prereq: ['agent_architect', 'agent_optimizer'], branch: 'agents' },
  { id: 'drone_speed', name: 'Быстрые роторы', desc: 'Дроны летают на 40 % быстрее.', packs: EA, count: 30, time: 15, prereq: ['autonomous_drones'], effects: { droneSpeed: 0.4 }, branch: 'drones' },
  // --- Autonomy ------------------------------------------------------------
  { id: 'autonomy_science', name: 'Пакет «Автономия»', desc: 'Урановое топливо + веса модели → пакет «Автономия».', packs: EA, count: 60, time: 22, prereq: ['uranium', 'training'], branch: 'colony' },
  { id: 'autonomy', name: 'Автономия', desc: 'Orchestrator ставит цели сам. Открывает эру «AI-колония».', packs: AU, count: 50, time: 25, prereq: ['autonomy_science', 'agent_orchestrator'], branch: 'colony' },
  { id: 'hallucination_2', name: 'Снижение галлюцинаций II', desc: 'Шанс багов ещё −30 %.', packs: AU, count: 40, time: 25, prereq: ['autonomy', 'hallucination_1'], effects: { hallucination: 0.3 }, branch: 'agents' },
  { id: 'speed_modules', name: 'Модули скорости', desc: 'Все цеха работают на 25 % быстрее.', packs: AU, count: 40, time: 25, prereq: ['autonomy_science'], effects: { craftSpeed: 0.25 }, branch: 'production' },
  { id: 'colony_spire', name: 'Шпиль Колонии', desc: 'Финальное мегасооружение автономной колонии.', packs: AU, count: 80, time: 25, prereq: ['autonomy'], branch: 'colony' },
];

export const TECHS: Record<string, TechDef> = Object.fromEntries(TECH_LIST.map((t) => [t.id, t]));

export const PACK_ITEMS: PackId[] = ['science_mech', 'science_elec', 'science_ai', 'science_auto'];

export function packItem(p: PackId): ItemId {
  return p;
}

/** Depth of a tech in the prerequisite DAG (for tree layout). */
export function techDepth(id: string, memo: Record<string, number> = {}): number {
  if (memo[id] !== undefined) return memo[id];
  const t = TECHS[id];
  const d = t.prereq.length ? 1 + Math.max(...t.prereq.map((p) => techDepth(p, memo))) : 0;
  memo[id] = d;
  return d;
}
