// Все игровые константы и справочники. Движок (engine.js) читает только отсюда,
// поэтому баланс настраивается в одном месте.

export const SAVE_KEY = 'vibetycoon.save.v1';
export const RECORDS_KEY = 'vibetycoon.records.v1';
export const SAVE_VERSION = 1;

export const START_MONEY = 600;
export const START_HOUR = 9; // игра начинается в 09:00 первого дня
export const BANKRUPTCY_LIMIT = -400; // ниже этого баланса — банкротство
export const LOG_LIMIT = 250;
export const HISTORY_LIMIT = 72;

// Скорость игры: сколько игровых часов проходит за одну реальную секунду.
export const SPEEDS = [
  { id: 0, label: 'Пауза', mult: 0 },
  { id: 1, label: '1×', mult: 1 },
  { id: 2, label: '2×', mult: 2 },
  { id: 4, label: '4×', mult: 4 },
];

// Глобальные коэффициенты экономики
export const ECONOMY = {
  energyPerTflop: 0.3, // $ за 1 TFLOPS загрузки в час (электричество и охлаждение)
  tempCreativity: 0.6, // вклад температуры в «уникальность» ответов (рост дохода)
  critPerError: 0.02, // доля ошибок, перерастающих в критическую галлюцинацию
  unsolvedErrorRate: 0.15, // доля «мусорных» ответов, когда модель слабее задачи
  qualityErrorWeight: 6, // насколько сильно средняя доля ошибок роняет качество
  qualityDebtWeight: 0.25, // штраф к качеству за каждый пункт тех-долга
  qualityDrift: 0.12, // скорость, с которой качество стремится к целевому
  critQualityHit: 10, // удар по качеству от одного инцидента
  slaThreshold: 45, // ниже этого качества клиенты требуют компенсаций
  slaPenaltyShare: 0.2, // доля выручки, уходящая в компенсации при низком качестве
  debtPerModuleLevel: 0.03, // пассивный рост тех-долга в час на уровень модуля
  debtPerAgent: 0.02, // пассивный рост тех-долга в час на активного агента
  outageDebtThreshold: 72, // с этого долга начинаются падения прода
  agentBaseCost: 40, // стоимость развёртывания агента
  agentCostStep: 40, // + за каждого уже развёрнутого агента
  serverRefund: 0.5, // доля цены, возвращаемая при продаже сервера
};

// Языковые модели. price — $ за 1k токенов, halluc — базовая вероятность
// галлюцинации на одну задачу, cap — «интеллект» (сравнивается со сложностью задачи).
export const MODELS = {
  micro: {
    id: 'micro',
    name: 'Микро-модель',
    tag: 'Fast LLM',
    tps: 140,
    price: 0.04,
    halluc: 0.018,
    cap: 1.0,
    compute: 3,
    keyCost: 0,
    color: 'cyan',
    blurb: 'Дешёвая и быстрая, но часто галлюцинирует. Отлично для простых тикетов.',
  },
  balanced: {
    id: 'balanced',
    name: 'Сбалансированная модель',
    tag: 'Mid LLM',
    tps: 80,
    price: 0.15,
    halluc: 0.007,
    cap: 2.0,
    compute: 5,
    keyCost: 180,
    color: 'sky',
    blurb: 'Золотая середина: справляется с текстами и продажами, но плывёт на сложном коде.',
  },
  reasoning: {
    id: 'reasoning',
    name: 'Продвинутая модель',
    tag: 'Reasoning LLM',
    tps: 35,
    price: 0.5,
    halluc: 0.0012,
    cap: 4.0,
    compute: 9,
    keyCost: 450,
    color: 'violet',
    blurb: 'Дорогая и медленная, зато почти не ошибается. Для задач, где ошибка стоит сотни долларов.',
  },
  local: {
    id: 'local',
    name: 'Локальная open-weight',
    tag: 'Self-hosted',
    tps: 90,
    price: 0.02,
    halluc: 0.011,
    cap: 1.7,
    compute: 20,
    keyCost: 0,
    requires: 'open_weights',
    color: 'emerald',
    blurb: 'Токены почти бесплатны, но модель съедает много TFLOPS вашего кластера.',
  },
};

// Бизнес-задачи. tokens — токены на одну задачу без системного промта,
// value — выручка за задачу, complexity — сложность (сравнивается с cap модели),
// creativity — насколько задача выигрывает от высокой температуры,
// sensitivity — множитель риска (ошибка в код-ревью опаснее, чем в тикете),
// critPenalty — штраф за критическую галлюцинацию.
export const TASKS = {
  support: {
    id: 'support',
    name: 'ИИ-Служба поддержки',
    short: 'Поддержка',
    unit: 'тикетов',
    tokens: 1400,
    value: 0.28,
    complexity: 0.8,
    creativity: 0.2,
    sensitivity: 1.0,
    critPenalty: 100,
    critText: 'пообещала клиенту бесплатный пожизненный тариф',
  },
  copywriter: {
    id: 'copywriter',
    name: 'ИИ-Копирайтер',
    short: 'Копирайтер',
    unit: 'статей',
    tokens: 2600,
    value: 1.1,
    complexity: 1.4,
    creativity: 1.0,
    sensitivity: 0.7,
    critPenalty: 150,
    critText: 'опубликовала статью с выдуманными цитатами реальных людей',
  },
  code: {
    id: 'code',
    name: 'ИИ-Аналитик кода',
    short: 'Код-ревью',
    unit: 'код-ревью',
    tokens: 7000,
    value: 15,
    complexity: 3.5,
    creativity: 0.3,
    sensitivity: 2.2,
    critPenalty: 450,
    critText: 'одобрила pull request с SQL-инъекцией, и он уехал в прод',
  },
  sales: {
    id: 'sales',
    name: 'ИИ-Менеджер продаж',
    short: 'Продажи',
    unit: 'писем',
    tokens: 1800,
    value: 0.6,
    complexity: 1.2,
    creativity: 0.8,
    sensitivity: 1.2,
    critPenalty: 220,
    critText: 'разослала клиентам скидку 95% на всё',
    requires: 'crm_integration',
  },
  data: {
    id: 'data',
    name: 'ИИ-Аналитик данных',
    short: 'Аналитика',
    unit: 'отчётов',
    tokens: 5200,
    value: 10,
    complexity: 3.0,
    creativity: 0.5,
    sensitivity: 1.6,
    critPenalty: 320,
    critText: 'выдумала рост выручки на 400% в отчёте для инвесторов',
    requires: 'data_platform',
  },
};

// Серверы: tflops — мощность, price — покупка, rent — аренда/обслуживание в час.
export const SERVERS = {
  t4: { id: 't4', name: 'GPU-нода T4', tflops: 8, price: 150, rent: 3 },
  a100: { id: 'a100', name: 'Кластер A100', tflops: 32, price: 900, rent: 10 },
  h100: { id: 'h100', name: 'Под H100', tflops: 128, price: 4800, rent: 32, requires: 'h100' },
  photonic: {
    id: 'photonic',
    name: 'Фотонный ускоритель',
    tflops: 512,
    price: 22000,
    rent: 110,
    requires: 'photonic',
  },
};

// Технологии (исследования). Покупаются один раз и сохраняются навсегда в рамках партии.
export const TECHS = {
  prompt_eng: {
    id: 'prompt_eng',
    name: 'Промт-инжиниринг 101',
    cost: 350,
    desc: 'Системный промт даёт тот же прирост качества при меньшей длине (кривая круче на ~40%).',
  },
  crm_integration: {
    id: 'crm_integration',
    name: 'Интеграция с CRM',
    cost: 600,
    desc: 'Открывает агента «ИИ-Менеджер продаж».',
  },
  multi_agent: {
    id: 'multi_agent',
    name: 'Мульти-агентная оркестрация',
    cost: 800,
    desc: '+3 слота для агентов.',
  },
  observability: {
    id: 'observability',
    name: 'Observability',
    cost: 900,
    desc: 'Открывает команду «Поднять стек мониторинга» в модуле вайбкодинга.',
  },
  ai_linters: {
    id: 'ai_linters',
    name: 'ИИ-линтеры',
    cost: 1000,
    desc: 'Рефакторинг убирает 85% долга вместо 70% и стоит на 30% дешевле.',
  },
  prompt_cache: {
    id: 'prompt_cache',
    name: 'Кэширование промтов',
    cost: 1200,
    requires: 'prompt_eng',
    desc: 'Системный промт кэшируется: он стоит 30% от обычной цены токенов.',
  },
  data_platform: {
    id: 'data_platform',
    name: 'Платформа данных',
    cost: 1500,
    desc: 'Открывает агента «ИИ-Аналитик данных».',
  },
  adaptive_prompts: {
    id: 'adaptive_prompts',
    name: 'Адаптивные промты',
    cost: 1800,
    requires: 'prompt_eng',
    desc: 'Открывает команду «Автопилот температуры».',
  },
  infra_as_code: {
    id: 'infra_as_code',
    name: 'Infrastructure as Code',
    cost: 2000,
    desc: 'Открывает команду «Автоскейлер кластера».',
  },
  open_weights: {
    id: 'open_weights',
    name: 'Open-weight модели',
    cost: 2500,
    desc: 'Открывает локальную модель: почти бесплатные токены ценой TFLOPS.',
  },
  h100: {
    id: 'h100',
    name: 'Контракт на H100',
    cost: 3000,
    desc: 'Открывает покупку подов H100 (128 TFLOPS).',
  },
  api_market: {
    id: 'api_market',
    name: 'Выход на API-маркетплейс',
    cost: 3000,
    desc: 'Открывает команду «Опубликовать API на маркетплейсе».',
  },
  self_healing: {
    id: 'self_healing',
    name: 'Самоисцеляющийся код',
    cost: 4000,
    requires: 'ai_linters',
    desc: 'Открывает команду «Авто-рефакторинг по расписанию».',
  },
  speculative: {
    id: 'speculative',
    name: 'Спекулятивное декодирование',
    cost: 5000,
    desc: 'Все модели генерируют на 25% больше токенов в секунду.',
  },
  swarm: {
    id: 'swarm',
    name: 'Рой агентов',
    cost: 6000,
    requires: 'multi_agent',
    desc: '+4 слота для агентов.',
  },
  photonic: {
    id: 'photonic',
    name: 'Фотонные вычисления',
    cost: 15000,
    requires: 'h100',
    desc: 'Открывает фотонный ускоритель (512 TFLOPS).',
  },
};

// Команды модуля вайбкодинга. hours — время генерации кода,
// cost — токены на генерацию, income — пассивный $/ч за уровень,
// compute — нагрузка на кластер (TFLOPS) за уровень, debt — прирост тех-долга.
export const MODULES = {
  db_cleanup: {
    id: 'db_cleanup',
    name: 'Написать скрипт очистки базы данных',
    file: 'scripts/cleanup_db.py',
    hours: 6,
    cost: 120,
    income: 7,
    compute: 1,
    debt: 8,
    maxLevel: 3,
    effect: '+$7/ч за уровень: меньше места, дешевле бэкапы.',
  },
  response_cache: {
    id: 'response_cache',
    name: 'Поднять кэш ответов в Redis',
    file: 'infra/redis_cache.ts',
    hours: 8,
    cost: 420,
    income: 0,
    compute: 2,
    debt: 9,
    maxLevel: 3,
    effect: '−10% затрат на токены за уровень: повторные вопросы не идут в модель.',
  },
  auto_reports: {
    id: 'auto_reports',
    name: 'Автогенерация отчётов для клиентов',
    file: 'services/reports.py',
    hours: 10,
    cost: 320,
    income: 16,
    compute: 2,
    debt: 11,
    maxLevel: 3,
    effect: '+$16/ч за уровень: клиенты платят за еженедельные отчёты.',
  },
  vector_db: {
    id: 'vector_db',
    name: 'Интегрировать векторную БД (RAG)',
    file: 'rag/vector_store.py',
    hours: 14,
    cost: 650,
    income: 0,
    compute: 4,
    debt: 12,
    maxLevel: 3,
    effect: '−12% токенов на задачу и −10% галлюцинаций за уровень: агенты ищут факты, а не выдумывают.',
  },
  guardrails: {
    id: 'guardrails',
    name: 'Внедрить Guardrails-фильтр ответов',
    file: 'safety/guardrails.py',
    hours: 12,
    cost: 800,
    income: 0,
    compute: 3,
    debt: 10,
    maxLevel: 3,
    effect: '−20% шанса критической галлюцинации за уровень.',
  },
  ci_cd: {
    id: 'ci_cd',
    name: 'Настроить CI/CD с автотестами',
    file: '.github/workflows/ci.yml',
    hours: 16,
    cost: 900,
    income: 0,
    compute: 1,
    debt: 6,
    maxLevel: 3,
    effect: '−25% пассивного роста долга и −15% долга от новых фич за уровень.',
  },
  monitoring: {
    id: 'monitoring',
    name: 'Поднять стек мониторинга',
    file: 'ops/observability.yaml',
    hours: 10,
    cost: 700,
    income: 0,
    compute: 2,
    debt: 7,
    maxLevel: 1,
    requires: 'observability',
    autonomy: true,
    effect: 'Предупреждает о рисках заранее и снижает шанс инцидента на 10%.',
  },
  api_marketplace: {
    id: 'api_marketplace',
    name: 'Опубликовать API на маркетплейсе',
    file: 'api/marketplace_gateway.go',
    hours: 20,
    cost: 2500,
    income: 70,
    compute: 8,
    debt: 18,
    maxLevel: 3,
    requires: 'api_market',
    effect: '+$70/ч за уровень: сторонние разработчики платят за ваш API.',
  },
  temp_autopilot: {
    id: 'temp_autopilot',
    name: 'Написать автопилот температуры',
    file: 'agents/temperature_autopilot.py',
    hours: 12,
    cost: 1500,
    income: 0,
    compute: 1,
    debt: 8,
    maxLevel: 1,
    requires: 'adaptive_prompts',
    autonomy: true,
    effect: 'После инцидента сам снижает температуру агента и дописывает промт.',
  },
  autoscaler: {
    id: 'autoscaler',
    name: 'Собрать автоскейлер кластера',
    file: 'infra/autoscaler.tf',
    hours: 18,
    cost: 2000,
    income: 0,
    compute: 1,
    debt: 10,
    maxLevel: 1,
    requires: 'infra_as_code',
    autonomy: true,
    effect: 'Сам докупает серверы, когда загрузка кластера выше 92%.',
  },
  auto_refactor: {
    id: 'auto_refactor',
    name: 'Внедрить авто-рефакторинг по расписанию',
    file: 'ops/self_healing.ts',
    hours: 24,
    cost: 3500,
    income: 0,
    compute: 2,
    debt: 5,
    maxLevel: 1,
    requires: 'self_healing',
    autonomy: true,
    effect: 'Сам запускает Vibe Clean, когда тех-долг выше 45%.',
  },
};

// Режимы генерации кода
export const BUILD_MODES = {
  vibe: { id: 'vibe', name: 'Вайб', hint: 'быстро, но больше тех-долга', time: 1, cost: 1, debt: 1 },
  careful: { id: 'careful', name: 'Тщательно', hint: '×1.8 времени, ×1.3 цены, долг ×0.4', time: 1.8, cost: 1.3, debt: 0.4 },
};

export const BASE_AGENT_SLOTS = 3;

// Условия полной автономии (цель игры)
export const AUTONOMY_GOAL = {
  modules: ['monitoring', 'temp_autopilot', 'autoscaler', 'auto_refactor'],
  guardrailsLevel: 1,
  minStreak: 48, // часов без критических галлюцинаций
  minNetIncome: 400, // $/ч средний чистый доход за последние 24 часа
  handsOffHours: 24, // часов без ручных действий
};

// Имена агентов по умолчанию
export const AGENT_NAMES = {
  support: ['Поддержка', 'Хелпдеск', 'Саппорт'],
  copywriter: ['Копирайтер', 'Редактор', 'Контент'],
  code: ['Ревьюер', 'Код-аналитик', 'Линтер'],
  sales: ['Продажи', 'Аутрич', 'Лидген'],
  data: ['Аналитик', 'BI', 'Дашборд'],
};
