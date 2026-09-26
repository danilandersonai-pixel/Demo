import type { ItemId } from '../data/items';
import type { BuildingType } from '../data/buildings';

/**
 * JS regex \w and \b are ASCII-only; rewrite them to treat Cyrillic letters as word characters.
 */
const W = 'а-яёa-z0-9_';
export function ru(rx: RegExp): RegExp {
  const src = rx.source
    .replace(/\\w/g, `[${W}]`)
    .replace(/\\b/g, `(?:(?<![${W}])(?=[${W}])|(?<=[${W}])(?![${W}]))`);
  return new RegExp(src, rx.flags);
}

/** Dictionaries for the offline intent engine (RU + EN). Order matters: specific patterns first. */
export const ITEM_PATTERNS: [RegExp, ItemId][] = ([
  [/медн\w* пластин|пластин\w* мед|copper plates?/, 'copper_plate'],
  [/железн\w* пластин|пластин\w* желез|iron plates?/, 'iron_plate'],
  [/кремниев\w* пластин|пластин\w* кремни|wafers?/, 'silicon_wafer'],
  [/тензорн|tensor/, 'tensor_chip'],
  [/модул\w* памят|memory modules?|\bпамят/, 'memory_module'],
  [/микросхем|микрочип|\bчип|chips?\b|microchips?/, 'microchip'],
  [/аккумулятор(?!н\w* станц)|батаре|batter(y|ies)/, 'battery'],
  [/электролит|electrolyte/, 'electrolyte'],
  [/пластик|plastics?/, 'plastic'],
  [/шестер[её]н|шестерн|gears?/, 'gear'],
  [/провод|wires?\b|cables?/, 'copper_wire'],
  [/магнит|magnets?/, 'magnet'],
  [/стал[ьи]\b|steel/, 'steel'],
  [/кирпич|bricks?/, 'stone_brick'],
  [/топлив|fuel/, 'uranium_fuel'],
  [/медн\w* руд|руд\w* мед|copper ore|\bмед[ьиую]\b|\bмедн|\bcopper\b/, 'copper_ore'],
  [/железн\w* руд|руд\w* желез|iron ore|\bжелез|\biron\b/, 'iron_ore'],
  [/кварц|пес[оо]?к|песка|sand|quartz|\bкремни/, 'silicon_ore'],
  [/редкозем|rare[ -]earth/, 'rare_earth'],
  [/уран|uranium/, 'uranium_ore'],
  [/нефт|\boil\b/, 'oil'],
  [/камн|камен|\bstone\b/, 'stone'],
  [/пакет\w* «?механ|red science|mechanic/, 'science_mech'],
  [/пакет\w* «?электрон/, 'science_elec'],
] as [RegExp, ItemId][]).map(([r, id]) => [ru(r), id] as [RegExp, ItemId]);

export const BUILDING_PATTERNS: [RegExp, BuildingType][] = ([
  [/плавильн|печ[ьи]\b|печей|smelters?|furnaces?/, 'smelter'],
  [/химзавод|химическ\w* завод|chem(ical)? plants?|\bchem\b/, 'chem'],
  [/сборочн\w* цех|сборщик\w*(?! ресурс)|assemblers?/, 'assembler'],
  [/буров\w* установ|качалк|pumpjacks?/, 'pumpjack'],
  [/\bбур(ы|ов|ами|ам)?\b|drills?|miners?|добытчик/, 'drill'],
  [/лаборатор|\blabs?\b/, 'lab'],
  [/дата-?центр|центр\w* данных|datacenters?|data centers?/, 'datacenter'],
  [/сервер|servers?/, 'server'],
  [/инференс|inference/, 'inference'],
  [/кластер\w* обучен|training/, 'training'],
  [/радар|radars?/, 'radar'],
  [/турел|turrets?/, 'turret'],
  [/электростанц|power ?plants?/, 'power_plant'],
  [/солнечн|solar/, 'solar'],
] as [RegExp, BuildingType][]).map(([r, id]) => [ru(r), id] as [RegExp, BuildingType]);

const RX_RAW = {
  power: /энерги|электричеств|питани|мощност|\bpower\b|energy|electricity/,
  less: /меньше|ниже|менее|не хватает|нехватк|мало\b|падает|упад[её]т|опуст|below|less than|under\b|drops?|\blow\b|недостат|дефицит|lacks?|short/,
  more: /больше|выше|более|превыш|свыше|много\b|above|more than|over\b|exceeds?|\bhigh\b|избыт|хватает(?! не)/,
  night: /ночью|ноч[ьи]|в темнот|at night|\bnight/,
  day: /дн[её]м|днём|\bday\b|during the day|утром/,
  enemies: /враг|атак|напад|сбойн|enem|attack|raid/,
  route: /достав|направля|направь|направ|вез[иу]|перевоз|подава|подай|маршрут|на переработку|route|deliver|feed|send .* to/,
  priority: /приоритет|в первую очередь|важнее|prioriti|priority/,
  disable: /отключ|выключ|останов|приостанов|стоп\b|выруби|заглуш|\bshut|disable|stop|turn off|pause|гаси/,
  enable: /(^|[^ы])включ|запуст|возобнов|\benable|turn on|\bstart|resume/,
  limit: /держи\w* запас|держать запас|поддерживай|запас\w* на уровне|на уровне|не больше \d|\blimit|keep .* (stock|at)|maintain|keep a stock/,
  notify: /уведом|сообщ|предупред|оповест|скажи|напомни|сигнал|\balert|notify|tell me|\bwarn/,
  recipe: /переключ|перевед|перестрой|switch .* to|set recipe|change recipe/,
  dispatch: /(отправ|пошли|направь)\w*( \w+)? дрон|дрон\w* .*(исследова|развед)|разведай|развед|исследуй\w* (ближ|неизв|точк)|\bscout|explore|send a drone/,
  balance: /поровну|равномерно|распредели|раздели|balance|evenly|split/,
  blueprint: /построй|спроектир|проект\w* лини|линию|line of|\bbuild\b|design a|layout|чертеж|чертёж/,
  refactor: /рефактор|почисти|упрости код|оптимизируй код|техдолг|refactor|clean ?up/,
  scan: /найди\w* (баг|ошиб)|баги|ошибк|провер|отлад|debug|find bugs?|что сломал/,
  status: /что происходит|статус|отч[её]т|как дела|сводк|report|status|overview/,
  log: /логир|записывай|отслеживай|\blog\b|track/,
  optimize: /оптимиз|ускор|узк\w* мест|bottleneck|optimi[sz]e|speed up|эффективн/,
  test: /тест|test/,
  every: /кажд\w* (\d+) ?(секунд\w*|сек|с)|every (\d+) ?(seconds?|s)\b/,
  all: /\bвс[её]\b|всех|everything|\ball\b/,
  except: /кроме|за исключением|except|but not/,
};
export const RX = Object.fromEntries(Object.entries(RX_RAW).map(([k, r]) => [k, ru(r)])) as Record<keyof typeof RX_RAW, RegExp>;

/** Class-name stems for items. */
export const ITEM_STEM: Partial<Record<ItemId, string>> = {
  copper_ore: 'Copper', copper_plate: 'Copper', iron_ore: 'Iron', iron_plate: 'Iron', microchip: 'Chip', battery: 'Battery',
  plastic: 'Plastic', gear: 'Gear', copper_wire: 'Wire', steel: 'Steel', silicon_wafer: 'Wafer', silicon_ore: 'Sand',
  electrolyte: 'Electrolyte', magnet: 'Magnet', memory_module: 'Memory', tensor_chip: 'Tensor', uranium_fuel: 'Fuel',
  uranium_ore: 'Uranium', rare_earth: 'RareEarth', oil: 'Oil', stone: 'Stone', stone_brick: 'Brick', science_mech: 'Science', science_elec: 'Science',
};

/** Short alias used in "<alias>_production" group names (reference: chip_production). */
export const PROD_ALIAS: Partial<Record<ItemId, string>> = {
  microchip: 'chip', battery: 'battery', plastic: 'plastic', gear: 'gear', copper_wire: 'wire', iron_plate: 'iron_plate', copper_plate: 'copper_plate',
  steel: 'steel', silicon_wafer: 'wafer', electrolyte: 'electrolyte', magnet: 'magnet', memory_module: 'memory', tensor_chip: 'tensor',
  uranium_fuel: 'fuel', stone_brick: 'brick', science_mech: 'science_mech', science_elec: 'science_elec',
  iron_ore: 'iron_ore', copper_ore: 'copper_ore', silicon_ore: 'sand', stone: 'stone', rare_earth: 'rare_earth', uranium_ore: 'uranium', oil: 'oil',
};

/** Plural alias used for priorities (reference: set_priority("batteries", 1)). */
export const PLURAL: Partial<Record<ItemId, string>> = {
  microchip: 'chips', battery: 'batteries', gear: 'gears', copper_wire: 'wires', magnet: 'magnets', memory_module: 'memory_modules',
  tensor_chip: 'tensor_chips', plastic: 'plastic', steel: 'steel', silicon_wafer: 'wafers', electrolyte: 'electrolyte', uranium_fuel: 'fuel',
  iron_plate: 'iron_plates', copper_plate: 'copper_plates', stone_brick: 'bricks',
};

export const BUILDING_GROUP: Partial<Record<BuildingType, string>> = {
  smelter: 'smelter', chem: 'chem', assembler: 'assembler', drill: 'drills', lab: 'labs', server: 'servers', datacenter: 'datacenter',
  inference: 'inference', training: 'training', radar: 'radars', turret: 'turrets', pumpjack: 'pumpjack', power_plant: 'power_plant', solar: 'solar',
};

export const BUILDING_STEM: Partial<Record<BuildingType, string>> = {
  smelter: 'Smelter', chem: 'Chem', assembler: 'Assembler', drill: 'Drill', lab: 'Lab', server: 'Server', datacenter: 'Datacenter',
  inference: 'Inference', training: 'Training', radar: 'Radar', turret: 'Turret', pumpjack: 'Pump', power_plant: 'Plant', solar: 'Solar',
};
