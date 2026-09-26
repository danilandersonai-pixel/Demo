import type { Sim } from '../sim/sim';

export interface QuestDef {
  id: string;
  era: number;
  title: string;
  desc: string;
  /** Returns progress [cur, max]. Done when cur >= max. */
  progress: (sim: Sim) => [number, number];
  reward?: { tokens?: number; compute?: number; items?: Record<string, number> };
  /** UI element to pulse while this is the current tutorial step. */
  highlight?: string;
}

const count = (sim: Sim, t: string) => sim.list.filter((e) => e.type === t && !e.ghost).length;
const made = (sim: Sim, item: string) => Math.floor(sim.stats.totalProduced[item] ?? 0);
const cap = (n: number, max: number): [number, number] => [Math.min(n, max), max];

export const QUESTS: QuestDef[] = [
  // --- Era 1 --------------------------------------------------------------
  { id: 'q_drill', era: 1, title: 'Первая добыча', desc: 'Откройте «Строить» и поставьте бур на месторождение руды.', progress: (s) => cap(count(s, 'drill'), 1), highlight: 'tool-build', reward: { tokens: 50 } },
  { id: 'q_belt', era: 1, title: 'Конвейер', desc: 'Протяните от бура конвейер — зажмите мышь и ведите линию.', progress: (s) => cap(count(s, 'belt'), 6), highlight: 'tool-build', reward: { tokens: 50 } },
  { id: 'q_smelt', era: 1, title: 'Плавка', desc: 'Манипулятор подаёт руду в плавильню. Произведите 10 железных пластин.', progress: (s) => cap(made(s, 'iron_plate'), 10), reward: { items: { iron_plate: 40 } } },
  { id: 'q_copper', era: 1, title: 'Построить базу', desc: 'Создайте первую автоматизированную линию по добыче и переработке меди.', progress: (s) => cap(made(s, 'copper_plate'), 30), reward: { items: { copper_plate: 40 }, tokens: 80 } },
  { id: 'q_gears', era: 1, title: 'Шестерни', desc: 'Сборочный цех с рецептом «Шестерня»: соберите 20 шестерён.', progress: (s) => cap(made(s, 'gear'), 20), reward: { items: { gear: 30 } } },
  { id: 'q_power', era: 1, title: 'Энергосеть', desc: 'Столбы ЛЭП несут энергию от базы. Поставьте 5 столбов.', progress: (s) => cap(count(s, 'pole'), 5), reward: { items: { copper_plate: 20 } } },
  { id: 'q_vibe', era: 1, title: 'Вайб-кодинг', desc: 'Нажмите «Код» (Tab), опишите задачу словами и примите скрипт ИИ.', progress: (s) => cap(s.git.commits.length, 1), highlight: 'tool-vibe', reward: { tokens: 150 } },
  { id: 'q_lab', era: 1, title: 'Наука', desc: 'Лаборатория + пакеты «Механика» (шестерня + медная пластина). Сделайте 10 пакетов.', progress: (s) => cap(made(s, 'science_mech'), 10), highlight: 'tool-research', reward: { tokens: 60 } },
  { id: 'q_research', era: 1, title: 'Первое открытие', desc: 'Выберите технологию в «Исследованиях» и изучите её.', progress: (s) => cap(s.research.done.length, 1), highlight: 'tool-research', reward: { tokens: 100 } },
  { id: 'q_oil', era: 1, title: 'Нефть и энергия', desc: 'Буровая установка на нефти + трубы + электростанция на 5 MW.', progress: (s) => cap(count(s, 'power_plant'), 1), reward: { items: { iron_plate: 60 } } },
  { id: 'q_plastic', era: 1, title: 'Пластик', desc: 'Химзавод превращает нефть в пластик. Произведите 50.', progress: (s) => cap(made(s, 'plastic'), 50), reward: { tokens: 100 } },
  { id: 'q_chips', era: 1, title: 'Микросхемы', desc: 'Кремний + провод + пластик → микросхемы. Произведите 50.', progress: (s) => cap(made(s, 'microchip'), 50), reward: { tokens: 150 } },
  { id: 'q_batteries', era: 1, title: 'Производство аккумуляторов', desc: 'Электролит + пластины → аккумуляторы на химзаводе.', progress: (s) => cap(made(s, 'battery'), 200), reward: { tokens: 200 } },
  // --- Era 2 --------------------------------------------------------------
  { id: 'q_aicore', era: 2, title: 'Развитие ИИ', desc: 'Постройте AI Core и назначьте первого агента.', progress: (s) => [Math.min(1, count(s, 'aicore')) + Math.min(1, s.ai.agents.filter((a) => a.role !== 'terminal').length), 2], highlight: 'tool-agents', reward: { tokens: 300, compute: 300 } },
  { id: 'q_agent_script', era: 2, title: 'Первый агент', desc: 'Попросите агента Coder написать скрипт и примите его.', progress: (s) => cap(s.git.commits.filter((c) => c.author !== 'Игрок' && c.author !== 'Терминал').length, 1), reward: { tokens: 200 } },
  { id: 'q_memory', era: 2, title: 'Память', desc: 'Установите 4 модуля памяти в AI Core (манипулятором или из склада).', progress: (s) => cap(s.list.reduce((a, e) => a + (e.modules ?? 0), 0), 4), reward: { tokens: 200 } },
  { id: 'q_sandbox', era: 2, title: 'Песочница', desc: 'Прогоните предложение агента в песочнице и посмотрите прогноз.', progress: (s) => cap(s.flags.sandboxRuns ?? 0, 1), reward: { tokens: 150 } },
  { id: 'q_servers', era: 2, title: 'Построить AI-серверы', desc: 'Серверные дают вычисления для агентов и обучения.', progress: (s) => cap(count(s, 'server'), 4), reward: { compute: 800 } },
  { id: 'q_chips500', era: 2, title: 'Произвести 500 микрочипов', desc: 'Масштабируйте линию микросхем — попросите Architect или Optimizer.', progress: (s) => cap(made(s, 'microchip'), 500), reward: { tokens: 400 } },
  { id: 'q_debug', era: 2, title: 'Отладка', desc: 'Debugger находит баги в скриптах. Примите его исправление.', progress: (s) => cap(s.flags.bugsFixed ?? 0, 1), reward: { tokens: 250 } },
  { id: 'q_ci', era: 2, title: 'Тесты фабрики', desc: 'Постройте CI-станцию и добавьте тест производства.', progress: (s) => [Math.min(1, count(s, 'ci')) + Math.min(1, s.ai.ciTests.length), 2], reward: { tokens: 250 } },
  { id: 'q_model', era: 2, title: 'Обучение', desc: 'Кластер обучения: доведите модель до v1.5.', progress: (s) => cap(Math.floor(s.ai.weightsTotal * 10) / 10, 10), reward: { tokens: 400 } },
  // --- Era 3 --------------------------------------------------------------
  { id: 'q_drones', era: 3, title: 'Рой', desc: 'Соберите в дрон-порте рабочего и логистического дронов.', progress: (s) => [Math.min(1, s.drones.filter((d) => d.kind === 'worker').length) + Math.min(1, s.drones.filter((d) => d.kind === 'logistic').length), 2], highlight: 'tool-drones', reward: { tokens: 300 } },
  { id: 'q_explore', era: 3, title: 'Расширение', desc: 'Найдите и исследуйте месторождение урана.', progress: (s) => [Math.min(1, s.world.deposits.filter((d) => d.res === 'uranium_ore' && s.world.isRevealed(d.x, d.y)).length) + Math.min(1, s.list.filter((e) => e.type === 'drill' && e.recipe === 'uranium_ore').length), 2], reward: { tokens: 300 } },
  { id: 'q_uranium', era: 3, title: 'Добыть уран', desc: 'Урановая руда нужна для топлива и пакетов «Автономия».', progress: (s) => cap(made(s, 'uranium_ore'), 200), reward: { tokens: 400 } },
  { id: 'q_architect', era: 3, title: 'Архитектор', desc: 'Попросите Architect спроектировать линию — он поставит призраки-чертёж.', progress: (s) => cap(s.flags.blueprintsPlaced ?? 0, 1), reward: { tokens: 300 } },
  { id: 'q_datacenter', era: 3, title: 'Дата-центр', desc: 'Постройте центр данных у воды.', progress: (s) => cap(count(s, 'datacenter'), 1), reward: { compute: 3000 } },
  // --- Era 4 --------------------------------------------------------------
  { id: 'q_autonomy', era: 4, title: 'Автономия', desc: 'Отдайте фабрику агентам: индекс автономии ≥ 50 %.', progress: (s) => cap(Math.floor(s.ai.autonomy * 100), 50), reward: { tokens: 500 } },
  { id: 'q_spire', era: 4, title: 'Шпиль Колонии', desc: 'Постройте финальное мегасооружение.', progress: (s) => cap(count(s, 'spire'), 1), reward: { tokens: 800 } },
  { id: 'q_victory', era: 4, title: 'От фабрики к цивилизации', desc: 'Удерживайте автономию ≥ 90 % 10 игровых минут.', progress: (s) => cap(Math.floor(s.ai.autonomyHeld / 60), 10) },
];

export const QUEST_BY_ID: Record<string, QuestDef> = Object.fromEntries(QUESTS.map((q) => [q.id, q]));
