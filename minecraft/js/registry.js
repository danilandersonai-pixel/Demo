/* Кубокрафт — реестр: блоки (id 0–255) и предметы (id 256+), их свойства,
   рецепты крафта и плавки. Блоки тоже предметы: их можно держать в руке. */
(function (KC) {
  'use strict';

  var T = KC.TILE;

  // ---- Идентификаторы блоков (старые номера сохранены для совместимости сохранений) --
  var B = {
    AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, COBBLE: 4, SAND: 5, LOG: 6, LEAVES: 7, PLANKS: 8, GLASS: 9,
    WATER: 10, BEDROCK: 11, BRICK: 12, SNOW: 13, SNOW_GRASS: 14, GRAVEL: 15, COAL_ORE: 16, IRON_ORE: 17,
    CACTUS: 18, SANDSTONE: 19, TALL_GRASS: 20, POPPY: 21, DANDELION: 22, STONE_BRICK: 23, BOOKSHELF: 24,
    WOOL_WHITE: 25, WOOL_RED: 26, WOOL_BLUE: 27, WOOL_YELLOW: 28, WOOL_GREEN: 29, BIRCH_LOG: 30,
    OBSIDIAN: 31, GOLD_BLOCK: 32,
    LAVA: 33, GOLD_ORE: 34, DIAMOND_ORE: 35, SPARK_ORE: 36, CLAY: 37, SUGAR_CANE: 38, CORNFLOWER: 39,
    TABLE: 40, FURNACE: 41, CHEST: 42, TORCH: 43, FARMLAND: 44, WHEAT: 45, SAPLING: 46, LADDER: 47,
    DOOR: 48, BED: 49, IRON_BLOCK: 50, DIAMOND_BLOCK: 51, TNT: 52, WIRE: 53, LEVER: 54, BUTTON: 55,
    PLATE: 56, SPARK_TORCH: 57, LAMP: 58, SPARK_BLOCK: 59, PISTON: 60, PISTON_HEAD: 61, PUMPKIN: 62,
    JACK: 63
  };

  // ---- Идентификаторы предметов -----------------------------------------------
  var I = {
    STICK: 256, COAL: 257, CHARCOAL: 258, IRON_INGOT: 259, GOLD_INGOT: 260, DIAMOND: 261, SPARK_DUST: 262,
    FLINT: 263, CLAY_BALL: 264, BRICK_ITEM: 265, STRING: 266, FEATHER: 267, LEATHER: 268, BONE: 269,
    GUNPOWDER: 270, PAPER: 271, BOOK: 272, SEEDS: 273, WHEAT_ITEM: 274, BREAD: 275, APPLE: 276,
    GOLDEN_APPLE: 277, PORK_RAW: 278, PORK_COOKED: 279, BEEF_RAW: 280, BEEF_COOKED: 281, MUTTON_RAW: 282,
    MUTTON_COOKED: 283, CHICKEN_RAW: 284, CHICKEN_COOKED: 285, ROTTEN_FLESH: 286, SPIDER_EYE: 287,
    BUCKET: 288, WATER_BUCKET: 289, LAVA_BUCKET: 290, BOW: 291, ARROW: 292, SHEARS: 293, FLINT_STEEL: 294,
    DYE_RED: 295, DYE_YELLOW: 296, DYE_BLUE: 297, DYE_GREEN: 298
  };
  // Инструменты 300–324 (материал × вид), броня 330–345 (материал × слот)
  var TOOL_MATS = ['wood', 'stone', 'iron', 'gold', 'diamond'];
  var TOOL_KINDS = ['pickaxe', 'axe', 'shovel', 'sword', 'hoe'];
  var ARMOR_MATS = ['leather', 'iron', 'gold', 'diamond'];
  var ARMOR_SLOTS = ['helmet', 'chest', 'legs', 'boots'];
  function toolId(mat, kind) { return 300 + TOOL_MATS.indexOf(mat) * 5 + TOOL_KINDS.indexOf(kind); }
  function armorId(mat, slot) { return 330 + ARMOR_MATS.indexOf(mat) * 4 + ARMOR_SLOTS.indexOf(slot); }

  var BLOCKS = [], ITEMS = [];

  // ---- Флаги для горячих циклов --------------------------------------------------
  var OPAQUE = new Uint8Array(256), SOLID = new Uint8Array(256), OCCLUDE = new Uint8Array(256);
  var LIGHTBLOCK = new Uint8Array(256), REPLACEABLE = new Uint8Array(256), LIQUID = new Uint8Array(256);
  var EMIT = new Uint8Array(256);

  // shape: cube | cross | crop | torch | liquid | ladder | door | bed | wire | lever | button | plate
  //        | chest | pistonHead | none
  // tool: pickaxe | axe | shovel | hoe | sword; tier: минимальный уровень кирки для добычи
  function blk(id, name, tiles, o) {
    var t = typeof tiles === 'string' ? { top: T[tiles], bottom: T[tiles], side: T[tiles] } : {
      top: T[tiles.top || tiles.side], bottom: T[tiles.bottom || tiles.top || tiles.side], side: T[tiles.side],
      front: tiles.front ? T[tiles.front] : undefined
    };
    var b = {
      id: id, name: name, tiles: t, shape: 'cube', opaque: true, solid: true, hardness: 1, tool: null, tier: 0,
      needsTool: false, mat: 'stone', light: 0, stack: 64
    };
    for (var k in o) b[k] = o[k];
    BLOCKS[id] = b;
    return b;
  }

  var plant = { shape: 'cross', opaque: false, solid: false, hardness: 0, mat: 'plant', support: 'soil' };
  function ext(base, more) { var r = {}, k; for (k in base) r[k] = base[k]; for (k in more) r[k] = more[k]; return r; }
  var rockPick = { tool: 'pickaxe', needsTool: true, tier: 1 };

  blk(B.AIR, 'Воздух', 'dirt', { shape: 'none', opaque: false, solid: false, hardness: -1, mat: 'none' });
  blk(B.GRASS, 'Трава', { top: 'grassTop', bottom: 'dirt', side: 'grassSide' }, { hardness: 0.6, tool: 'shovel', mat: 'grass', drop: [[B.DIRT, 1]] });
  blk(B.DIRT, 'Земля', 'dirt', { hardness: 0.5, tool: 'shovel', mat: 'dirt' });
  blk(B.STONE, 'Камень', 'stone', ext(rockPick, { hardness: 1.5, drop: [[B.COBBLE, 1]] }));
  blk(B.COBBLE, 'Булыжник', 'cobble', ext(rockPick, { hardness: 2 }));
  blk(B.SAND, 'Песок', 'sand', { hardness: 0.5, tool: 'shovel', mat: 'sand', falls: true });
  blk(B.LOG, 'Дубовое бревно', { top: 'logTop', side: 'logSide' }, { hardness: 2, tool: 'axe', mat: 'wood', fuel: 300 });
  blk(B.LEAVES, 'Листва', 'leaves', { opaque: false, leaves: true, hardness: 0.2, tool: 'shears', mat: 'plant' });
  blk(B.PLANKS, 'Доски', 'planks', { hardness: 2, tool: 'axe', mat: 'wood', fuel: 300 });
  blk(B.GLASS, 'Стекло', 'glass', { opaque: false, glass: true, hardness: 0.3, mat: 'glass', drop: [] });
  blk(B.WATER, 'Вода', 'water', { shape: 'liquid', opaque: false, solid: false, hardness: -1, mat: 'water', liquid: true });
  blk(B.BEDROCK, 'Коренная порода', 'bedrock', { hardness: -1 });
  blk(B.BRICK, 'Кирпичи', 'brick', ext(rockPick, { hardness: 2 }));
  blk(B.SNOW, 'Снег', 'snow', { hardness: 0.2, tool: 'shovel', mat: 'snow' });
  blk(B.SNOW_GRASS, 'Заснеженная трава', { top: 'snow', bottom: 'dirt', side: 'snowSide' }, { hardness: 0.6, tool: 'shovel', mat: 'snow', drop: [[B.DIRT, 1]] });
  blk(B.GRAVEL, 'Гравий', 'gravel', { hardness: 0.6, tool: 'shovel', mat: 'sand', falls: true,
    drop: function (m, r) { return r() < 0.12 ? [[I.FLINT, 1]] : [[B.GRAVEL, 1]]; } });
  blk(B.COAL_ORE, 'Угольная руда', 'coalOre', ext(rockPick, { hardness: 3, drop: [[I.COAL, 1]] }));
  blk(B.IRON_ORE, 'Железная руда', 'ironOre', ext(rockPick, { hardness: 3, tier: 2 }));
  blk(B.CACTUS, 'Кактус', { top: 'cactusTop', side: 'cactusSide' }, { shape: 'cactus', opaque: false, hardness: 0.4, mat: 'cloth', support: 'cactus', hurts: 1 });
  blk(B.SANDSTONE, 'Песчаник', { top: 'sandstoneTop', side: 'sandstoneSide' }, ext(rockPick, { hardness: 0.8 }));
  blk(B.TALL_GRASS, 'Высокая трава', 'tallGrass', ext(plant, { replaceable: true,
    drop: function (m, r) { return r() < 0.125 ? [[I.SEEDS, 1]] : []; } }));
  blk(B.POPPY, 'Мак', 'poppy', plant);
  blk(B.DANDELION, 'Одуванчик', 'dandelion', plant);
  blk(B.STONE_BRICK, 'Каменные кирпичи', 'stoneBrick', ext(rockPick, { hardness: 1.5 }));
  blk(B.BOOKSHELF, 'Книжная полка', { top: 'planks', side: 'bookshelf' }, { hardness: 1.5, tool: 'axe', mat: 'wood', fuel: 300, drop: [[I.BOOK, 3]] });
  blk(B.WOOL_WHITE, 'Белая шерсть', 'woolWhite', { hardness: 0.8, tool: 'shears', mat: 'cloth' });
  blk(B.WOOL_RED, 'Красная шерсть', 'woolRed', { hardness: 0.8, tool: 'shears', mat: 'cloth' });
  blk(B.WOOL_BLUE, 'Синяя шерсть', 'woolBlue', { hardness: 0.8, tool: 'shears', mat: 'cloth' });
  blk(B.WOOL_YELLOW, 'Жёлтая шерсть', 'woolYellow', { hardness: 0.8, tool: 'shears', mat: 'cloth' });
  blk(B.WOOL_GREEN, 'Зелёная шерсть', 'woolGreen', { hardness: 0.8, tool: 'shears', mat: 'cloth' });
  blk(B.BIRCH_LOG, 'Берёзовое бревно', { top: 'birchTop', side: 'birchSide' }, { hardness: 2, tool: 'axe', mat: 'wood', fuel: 300 });
  blk(B.OBSIDIAN, 'Обсидиан', 'obsidian', ext(rockPick, { hardness: 50, tier: 4, blastProof: true }));
  blk(B.GOLD_BLOCK, 'Золотой блок', 'goldBlock', ext(rockPick, { hardness: 3, tier: 3, mat: 'metal' }));

  blk(B.LAVA, 'Лава', 'lava', { shape: 'liquid', opaque: false, solid: false, hardness: -1, mat: 'water', liquid: true, light: 15, blastProof: true });
  blk(B.GOLD_ORE, 'Золотая руда', 'goldOre', ext(rockPick, { hardness: 3, tier: 3 }));
  blk(B.DIAMOND_ORE, 'Алмазная руда', 'diamondOre', ext(rockPick, { hardness: 3, tier: 3, drop: [[I.DIAMOND, 1]] }));
  blk(B.SPARK_ORE, 'Искровая руда', 'sparkOre', ext(rockPick, { hardness: 3, tier: 3,
    drop: function (m, r) { return [[I.SPARK_DUST, 4 + (r() < 0.5 ? 1 : 0)]]; } }));
  blk(B.CLAY, 'Глина', 'clay', { hardness: 0.6, tool: 'shovel', mat: 'dirt', drop: [[I.CLAY_BALL, 4]] });
  blk(B.SUGAR_CANE, 'Тростник', 'sugarCane', ext(plant, { support: 'cane' }));
  blk(B.CORNFLOWER, 'Василёк', 'cornflower', plant);
  blk(B.TABLE, 'Верстак', { top: 'tableTop', bottom: 'planks', side: 'tableSide', front: 'tableFront' }, { hardness: 2.5, tool: 'axe', mat: 'wood', fuel: 300, use: 'table' });
  blk(B.FURNACE, 'Печь', { top: 'furnaceTop', side: 'furnaceSide', front: 'furnaceFront' }, ext(rockPick, { hardness: 3.5, use: 'furnace', entity: 'furnace' }));
  blk(B.CHEST, 'Сундук', { top: 'chestTop', side: 'chestSide', front: 'chestFront' }, { shape: 'chest', opaque: false, hardness: 2.5, tool: 'axe', mat: 'wood', fuel: 300, use: 'chest', entity: 'chest' });
  blk(B.TORCH, 'Факел', 'torch', { shape: 'torch', opaque: false, solid: false, hardness: 0, mat: 'wood', light: 14, support: 'attached' });
  blk(B.FARMLAND, 'Пашня', { top: 'farmland', bottom: 'dirt', side: 'dirt' }, { hardness: 0.6, tool: 'shovel', mat: 'dirt', drop: [[B.DIRT, 1]] });
  blk(B.WHEAT, 'Пшеница', 'wheat0', { shape: 'crop', opaque: false, solid: false, hardness: 0, mat: 'plant', support: 'farmland',
    drop: function (m, r) {
      if (m >= 7) return [[I.WHEAT_ITEM, 1], [I.SEEDS, 1 + Math.floor(r() * 3)]];
      return [[I.SEEDS, 1]];
    } });
  blk(B.SAPLING, 'Саженец', 'saplingOak', ext(plant, { fuel: 100 }));
  blk(B.LADDER, 'Лестница', 'ladder', { shape: 'ladder', opaque: false, solid: false, hardness: 0.4, tool: 'axe', mat: 'wood', support: 'attached', climb: true, fuel: 300 });
  blk(B.DOOR, 'Дверь', { top: 'doorTop', side: 'doorBottom' }, { shape: 'door', opaque: false, hardness: 3, tool: 'axe', mat: 'wood', support: 'door', use: 'door' });
  blk(B.BED, 'Кровать', { top: 'bedTop', bottom: 'planks', side: 'bedSide' }, { shape: 'bed', opaque: false, hardness: 0.2, mat: 'cloth', use: 'bed' });
  blk(B.IRON_BLOCK, 'Железный блок', 'ironBlock', ext(rockPick, { hardness: 5, tier: 2, mat: 'metal' }));
  blk(B.DIAMOND_BLOCK, 'Алмазный блок', 'diamondBlock', ext(rockPick, { hardness: 5, tier: 3, mat: 'metal' }));
  blk(B.TNT, 'Динамит', { top: 'tntTop', bottom: 'tntBottom', side: 'tntSide' }, { hardness: 0, mat: 'plant', use: 'tnt' });
  blk(B.WIRE, 'Искровая пыль', 'wireOff', { shape: 'wire', opaque: false, solid: false, hardness: 0, mat: 'plant', support: 'floor', drop: [[I.SPARK_DUST, 1]] });
  blk(B.LEVER, 'Рычаг', 'cobble', { shape: 'lever', opaque: false, solid: false, hardness: 0.5, mat: 'wood', support: 'attached', use: 'lever' });
  blk(B.BUTTON, 'Кнопка', 'stone', { shape: 'button', opaque: false, solid: false, hardness: 0.5, mat: 'stone', support: 'attached', use: 'button' });
  blk(B.PLATE, 'Нажимная плита', 'stone', { shape: 'plate', opaque: false, solid: false, hardness: 0.5, tool: 'pickaxe', mat: 'stone', support: 'floor' });
  blk(B.SPARK_TORCH, 'Искровой факел', 'sparkTorchOn', { shape: 'torch', opaque: false, solid: false, hardness: 0, mat: 'wood', support: 'attached' });
  blk(B.LAMP, 'Искровая лампа', 'lampOff', { hardness: 0.3, mat: 'glass' });
  blk(B.SPARK_BLOCK, 'Искроблок', 'sparkBlock', ext(rockPick, { hardness: 5, mat: 'metal' }));
  blk(B.PISTON, 'Поршень', { top: 'pistonFace', bottom: 'pistonBack', side: 'pistonSide' }, { hardness: 0.5, tool: 'pickaxe', mat: 'stone' });
  blk(B.PISTON_HEAD, 'Головка поршня', { top: 'pistonFace', bottom: 'pistonFace', side: 'pistonSide' }, { shape: 'pistonHead', opaque: false, hardness: 0.5, mat: 'stone', drop: [] });
  blk(B.PUMPKIN, 'Тыква', { top: 'pumpkinTop', side: 'pumpkinSide', front: 'pumpkinFace' }, { hardness: 1, tool: 'axe', mat: 'wood' });
  blk(B.JACK, 'Тыква-светильник', { top: 'pumpkinTop', side: 'pumpkinSide', front: 'jackFace' }, { hardness: 1, tool: 'axe', mat: 'wood', light: 15 });

  // ---- Флаги ------------------------------------------------------------------------
  BLOCKS.forEach(function (b, id) {
    if (!b) return;
    OPAQUE[id] = b.opaque && b.shape === 'cube' ? 1 : 0;
    SOLID[id] = b.solid ? 1 : 0;
    OCCLUDE[id] = (OPAQUE[id] || b.leaves) ? 1 : 0;
    LIGHTBLOCK[id] = (OPAQUE[id] || b.leaves) ? 1 : 0;
    REPLACEABLE[id] = (id === B.AIR || b.liquid || b.replaceable) ? 1 : 0;
    LIQUID[id] = b.liquid ? 1 : 0;
    EMIT[id] = b.light || 0;
  });

  // Свечение с учётом состояния блока
  function emission(id, meta) {
    if (id === B.FURNACE) return (meta & 4) ? 13 : 0;
    if (id === B.LAMP) return meta & 1 ? 15 : 0;
    if (id === B.SPARK_TORCH) return (meta & 8) ? 0 : 7;
    return EMIT[id];
  }

  // ---- Предметы ------------------------------------------------------------------
  function item(id, name, sprite, o) {
    var it = { id: id, name: name, sprite: T[sprite], stack: 64 };
    for (var k in o) it[k] = o[k];
    ITEMS[id] = it;
    return it;
  }
  // Блоки как предметы; у неквадратных блоков своя иконка-спрайт
  var BLOCK_SPRITES = {};
  BLOCK_SPRITES[B.TALL_GRASS] = 'tallGrass'; BLOCK_SPRITES[B.POPPY] = 'poppy'; BLOCK_SPRITES[B.DANDELION] = 'dandelion';
  BLOCK_SPRITES[B.CORNFLOWER] = 'cornflower'; BLOCK_SPRITES[B.SUGAR_CANE] = 'sugarCane'; BLOCK_SPRITES[B.SAPLING] = 'saplingOak';
  BLOCK_SPRITES[B.TORCH] = 'torch'; BLOCK_SPRITES[B.LADDER] = 'ladder'; BLOCK_SPRITES[B.DOOR] = 'doorItem';
  BLOCK_SPRITES[B.BED] = 'bedItem'; BLOCK_SPRITES[B.LEVER] = 'leverItem'; BLOCK_SPRITES[B.BUTTON] = 'buttonItem';
  BLOCK_SPRITES[B.PLATE] = 'plateItem'; BLOCK_SPRITES[B.SPARK_TORCH] = 'sparkTorchOn';
  var NOT_ITEMS = [B.AIR, B.WATER, B.LAVA, B.WHEAT, B.WIRE, B.PISTON_HEAD, B.FARMLAND];
  BLOCKS.forEach(function (b, id) {
    if (!b || NOT_ITEMS.indexOf(id) >= 0) return;
    ITEMS[id] = { id: id, name: b.name, block: id, stack: 64, fuel: b.fuel };
    if (BLOCK_SPRITES[id]) ITEMS[id].sprite = T[BLOCK_SPRITES[id]];
  });
  ITEMS[B.DOOR].stack = 16;
  ITEMS[B.BED].stack = 1;

  item(I.STICK, 'Палка', 'stick', { fuel: 100 });
  item(I.COAL, 'Уголь', 'coal', { fuel: 1600 });
  item(I.CHARCOAL, 'Древесный уголь', 'charcoal', { fuel: 1600 });
  item(I.IRON_INGOT, 'Железный слиток', 'ironIngot');
  item(I.GOLD_INGOT, 'Золотой слиток', 'goldIngot');
  item(I.DIAMOND, 'Алмаз', 'diamond');
  item(I.SPARK_DUST, 'Искровая пыль', 'sparkDust', { place: B.WIRE });
  item(I.FLINT, 'Кремень', 'flint');
  item(I.CLAY_BALL, 'Комок глины', 'clayBall');
  item(I.BRICK_ITEM, 'Кирпич', 'brickItem');
  item(I.STRING, 'Нить', 'string');
  item(I.FEATHER, 'Перо', 'feather');
  item(I.LEATHER, 'Кожа', 'leather');
  item(I.BONE, 'Кость', 'bone');
  item(I.GUNPOWDER, 'Порох', 'gunpowder');
  item(I.PAPER, 'Бумага', 'paper');
  item(I.BOOK, 'Книга', 'book');
  item(I.SEEDS, 'Семена пшеницы', 'seeds', { place: B.WHEAT });
  item(I.WHEAT_ITEM, 'Пшеница', 'wheatItem');
  item(I.BREAD, 'Хлеб', 'bread', { food: { h: 5, s: 6 } });
  item(I.APPLE, 'Яблоко', 'apple', { food: { h: 4, s: 2.4 } });
  item(I.GOLDEN_APPLE, 'Золотое яблоко', 'goldenApple', { food: { h: 4, s: 9.6, effect: 'regen', always: true } });
  item(I.PORK_RAW, 'Сырая свинина', 'porkRaw', { food: { h: 3, s: 1.8 } });
  item(I.PORK_COOKED, 'Жареная свинина', 'porkCooked', { food: { h: 8, s: 12.8 } });
  item(I.BEEF_RAW, 'Сырая говядина', 'beefRaw', { food: { h: 3, s: 1.8 } });
  item(I.BEEF_COOKED, 'Стейк', 'beefCooked', { food: { h: 8, s: 12.8 } });
  item(I.MUTTON_RAW, 'Сырая баранина', 'muttonRaw', { food: { h: 2, s: 1.2 } });
  item(I.MUTTON_COOKED, 'Жареная баранина', 'muttonCooked', { food: { h: 6, s: 9.6 } });
  item(I.CHICKEN_RAW, 'Сырая курятина', 'chickenRaw', { food: { h: 2, s: 1.2, effect: 'hunger', chance: 0.3 } });
  item(I.CHICKEN_COOKED, 'Жареная курятина', 'chickenCooked', { food: { h: 6, s: 7.2 } });
  item(I.ROTTEN_FLESH, 'Гнилая плоть', 'rottenFlesh', { food: { h: 4, s: 0.8, effect: 'hunger', chance: 0.8 } });
  item(I.SPIDER_EYE, 'Паучий глаз', 'spiderEye', { food: { h: 2, s: 3.2, effect: 'poison', chance: 1 } });
  item(I.BUCKET, 'Ведро', 'bucket', { stack: 16 });
  item(I.WATER_BUCKET, 'Ведро воды', 'waterBucket', { stack: 1 });
  item(I.LAVA_BUCKET, 'Ведро лавы', 'lavaBucket', { stack: 1, fuel: 20000 });
  item(I.BOW, 'Лук', 'bow', { stack: 1, dur: 384, fuel: 300 });
  item(I.ARROW, 'Стрела', 'arrow');
  item(I.SHEARS, 'Ножницы', 'shears', { stack: 1, dur: 238, tool: { kind: 'shears', tier: 0, speed: 1, dmg: 1 } });
  item(I.FLINT_STEEL, 'Огниво', 'flintSteel', { stack: 1, dur: 64 });
  item(I.DYE_RED, 'Красный краситель', 'dyeRed');
  item(I.DYE_YELLOW, 'Жёлтый краситель', 'dyeYellow');
  item(I.DYE_BLUE, 'Синий краситель', 'dyeBlue');
  item(I.DYE_GREEN, 'Зелёный краситель', 'dyeGreen');

  var MAT_RU = { wood: 'Деревянн', stone: 'Каменн', iron: 'Железн', gold: 'Золот', diamond: 'Алмазн', leather: 'Кожан' };
  var TOOL_RU = { pickaxe: ['ая', 'кирка'], axe: ['ый', 'топор'], shovel: ['ая', 'лопата'], sword: ['ый', 'меч'], hoe: ['ая', 'мотыга'] };
  var ARMOR_RU = { helmet: ['ый', 'шлем'], chest: ['ый', 'нагрудник'], legs: ['ые', 'поножи'], boots: ['ые', 'сапоги'] };
  var TIER = { wood: 1, stone: 2, iron: 3, gold: 1, diamond: 4 };
  var SPEED = { wood: 2, stone: 4, iron: 6, gold: 12, diamond: 8 };
  var DUR = { wood: 59, stone: 131, iron: 250, gold: 32, diamond: 1561 };
  var DMG = { pickaxe: [2, 3, 4, 2, 5], axe: [3, 4, 5, 3, 6], shovel: [1.5, 2.5, 3.5, 1.5, 4.5], sword: [4, 5, 6, 4, 7], hoe: [1, 1, 1, 1, 1] };
  // «Золотой», а не «золотый»: у золота мужской род с ударным окончанием
  function adj(m, end) { return MAT_RU[m] + (m === 'gold' && end === 'ый' ? 'ой' : end); }
  TOOL_MATS.forEach(function (m, mi) {
    TOOL_KINDS.forEach(function (k) {
      var ru = TOOL_RU[k];
      item(toolId(m, k), adj(m, ru[0]) + ' ' + ru[1], m + '_' + k, {
        stack: 1, dur: DUR[m], fuel: m === 'wood' ? 200 : undefined,
        tool: { kind: k, tier: TIER[m], speed: SPEED[m], dmg: DMG[k][mi], mat: m }
      });
    });
  });
  var ARMOR_PTS = { leather: [1, 3, 2, 1], iron: [2, 6, 5, 2], gold: [2, 5, 3, 1], diamond: [3, 8, 6, 3] };
  var ARMOR_DUR = { leather: 5, iron: 15, gold: 7, diamond: 33 };
  ARMOR_MATS.forEach(function (m) {
    ARMOR_SLOTS.forEach(function (s, si) {
      var ru = ARMOR_RU[s];
      item(armorId(m, s), adj(m, ru[0]) + ' ' + ru[1], m + '_' + s, {
        stack: 1, dur: ARMOR_DUR[m] * [11, 16, 15, 13][si], armor: { slot: si, points: ARMOR_PTS[m][si], mat: m }
      });
    });
  });

  // ---- Добыча ------------------------------------------------------------------
  // Можно ли добыть блок этим предметом (null — рукой)
  function canHarvest(b, it) {
    if (!b.needsTool) return true;
    var t = it && it.tool;
    return !!t && t.kind === b.tool && t.tier >= b.tier;
  }

  // Время ломания в секундах (как в оригинальной механике: твёрдость × 1,5 / скорость)
  function breakTime(b, it, onGround, inWater) {
    if (b.hardness < 0) return Infinity;
    if (b.hardness === 0) return 0;
    var t = it && it.tool, speed = 1;
    if (t && t.kind === b.tool) speed = t.speed;
    if (t && t.kind === 'shears' && (b.leaves || b.mat === 'cloth')) speed = b.leaves ? 15 : 5;
    if (t && t.kind === 'sword' && b.leaves) speed = 1.5;
    var time = b.hardness * (canHarvest(b, it) ? 1.5 : 5) / speed;
    if (!onGround) time *= 5;
    if (inWater) time *= 5;
    return time;
  }

  // Что выпадает из блока: список [id, количество]
  function drops(id, meta, it, rnd) {
    var b = BLOCKS[id];
    if (!b || !canHarvest(b, it)) return [];
    var t = it && it.tool;
    if (b.leaves) {
      if (t && t.kind === 'shears') return [[B.LEAVES, 1]];
      var out = [];
      if (rnd() < 0.05) out.push([B.SAPLING, 1, meta & 1]);
      if (!(meta & 1) && rnd() < 0.01) out.push([I.APPLE, 1]);
      return out;
    }
    if (id === B.TALL_GRASS && t && t.kind === 'shears') return [[B.TALL_GRASS, 1]];
    if (typeof b.drop === 'function') return b.drop(meta, rnd, it);
    if (b.drop) return b.drop;
    if (!ITEMS[id]) return [];
    return [[id, 1]];
  }

  // ---- Рецепты ------------------------------------------------------------------
  var RECIPES = [];
  var LOGS = [B.LOG, B.BIRCH_LOG];
  function shaped(out, n, rows, keys) {
    var k = {};
    for (var ch in keys) k[ch] = [].concat(keys[ch]);
    RECIPES.push({ out: out, count: n, rows: rows, keys: k, w: rows[0].length, h: rows.length });
  }
  function shapeless(out, n, ings) {
    RECIPES.push({ out: out, count: n, shapeless: ings.map(function (x) { return [].concat(x); }), w: 0, h: 0, size: ings.length });
  }

  shapeless(B.PLANKS, 4, [LOGS]);
  shaped(I.STICK, 4, ['P', 'P'], { P: B.PLANKS });
  shaped(B.TABLE, 1, ['PP', 'PP'], { P: B.PLANKS });
  shaped(B.TORCH, 4, ['C', 'S'], { C: [I.COAL, I.CHARCOAL], S: I.STICK });
  shaped(B.FURNACE, 1, ['CCC', 'C C', 'CCC'], { C: B.COBBLE });
  shaped(B.CHEST, 1, ['PPP', 'P P', 'PPP'], { P: B.PLANKS });
  var TOOL_MAT_ITEM = { wood: B.PLANKS, stone: B.COBBLE, iron: I.IRON_INGOT, gold: I.GOLD_INGOT, diamond: I.DIAMOND };
  TOOL_MATS.forEach(function (m) {
    var M = TOOL_MAT_ITEM[m];
    shaped(toolId(m, 'pickaxe'), 1, ['MMM', ' S ', ' S '], { M: M, S: I.STICK });
    shaped(toolId(m, 'axe'), 1, ['MM', 'MS', ' S'], { M: M, S: I.STICK });
    shaped(toolId(m, 'shovel'), 1, ['M', 'S', 'S'], { M: M, S: I.STICK });
    shaped(toolId(m, 'sword'), 1, ['M', 'M', 'S'], { M: M, S: I.STICK });
    shaped(toolId(m, 'hoe'), 1, ['MM', ' S', ' S'], { M: M, S: I.STICK });
  });
  var ARMOR_MAT_ITEM = { leather: I.LEATHER, iron: I.IRON_INGOT, gold: I.GOLD_INGOT, diamond: I.DIAMOND };
  ARMOR_MATS.forEach(function (m) {
    var M = ARMOR_MAT_ITEM[m];
    shaped(armorId(m, 'helmet'), 1, ['MMM', 'M M'], { M: M });
    shaped(armorId(m, 'chest'), 1, ['M M', 'MMM', 'MMM'], { M: M });
    shaped(armorId(m, 'legs'), 1, ['MMM', 'M M', 'M M'], { M: M });
    shaped(armorId(m, 'boots'), 1, ['M M', 'M M'], { M: M });
  });
  shaped(I.BREAD, 1, ['WWW'], { W: I.WHEAT_ITEM });
  shaped(I.BUCKET, 1, ['I I', ' I '], { I: I.IRON_INGOT });
  shaped(I.SHEARS, 1, [' I', 'I '], { I: I.IRON_INGOT });
  shaped(I.BOW, 1, [' SX', 'S X', ' SX'], { S: I.STICK, X: I.STRING });
  shaped(I.ARROW, 4, ['F', 'S', 'E'], { F: I.FLINT, S: I.STICK, E: I.FEATHER });
  shapeless(I.FLINT_STEEL, 1, [I.IRON_INGOT, I.FLINT]);
  shaped(B.BED, 1, ['WWW', 'PPP'], { W: [B.WOOL_WHITE, B.WOOL_RED, B.WOOL_BLUE, B.WOOL_YELLOW, B.WOOL_GREEN], P: B.PLANKS });
  shaped(B.DOOR, 3, ['PP', 'PP', 'PP'], { P: B.PLANKS });
  shaped(B.LADDER, 3, ['S S', 'SSS', 'S S'], { S: I.STICK });
  shapeless(I.GUNPOWDER, 2, [[I.COAL, I.CHARCOAL], I.FLINT]);
  shaped(B.TNT, 1, ['GSG', 'SGS', 'GSG'], { G: I.GUNPOWDER, S: B.SAND });
  shaped(B.STONE_BRICK, 4, ['SS', 'SS'], { S: B.STONE });
  shaped(B.SANDSTONE, 1, ['SS', 'SS'], { S: B.SAND });
  shaped(B.BRICK, 1, ['BB', 'BB'], { B: I.BRICK_ITEM });
  shaped(B.CLAY, 1, ['CC', 'CC'], { C: I.CLAY_BALL });
  shaped(I.PAPER, 3, ['CCC'], { C: B.SUGAR_CANE });
  shapeless(I.BOOK, 1, [I.PAPER, I.PAPER, I.PAPER, I.LEATHER]);
  shaped(B.BOOKSHELF, 1, ['PPP', 'BBB', 'PPP'], { P: B.PLANKS, B: I.BOOK });
  shaped(I.GOLDEN_APPLE, 1, ['GGG', 'GAG', 'GGG'], { G: I.GOLD_INGOT, A: I.APPLE });
  shaped(B.IRON_BLOCK, 1, ['III', 'III', 'III'], { I: I.IRON_INGOT });
  shaped(B.GOLD_BLOCK, 1, ['III', 'III', 'III'], { I: I.GOLD_INGOT });
  shaped(B.DIAMOND_BLOCK, 1, ['III', 'III', 'III'], { I: I.DIAMOND });
  shaped(B.SPARK_BLOCK, 1, ['III', 'III', 'III'], { I: I.SPARK_DUST });
  shapeless(I.IRON_INGOT, 9, [B.IRON_BLOCK]);
  shapeless(I.GOLD_INGOT, 9, [B.GOLD_BLOCK]);
  shapeless(I.DIAMOND, 9, [B.DIAMOND_BLOCK]);
  shapeless(I.SPARK_DUST, 9, [B.SPARK_BLOCK]);
  shapeless(I.DYE_RED, 1, [B.POPPY]);
  shapeless(I.DYE_YELLOW, 1, [B.DANDELION]);
  shapeless(I.DYE_BLUE, 1, [B.CORNFLOWER]);
  shapeless(B.WOOL_RED, 1, [B.WOOL_WHITE, I.DYE_RED]);
  shapeless(B.WOOL_YELLOW, 1, [B.WOOL_WHITE, I.DYE_YELLOW]);
  shapeless(B.WOOL_BLUE, 1, [B.WOOL_WHITE, I.DYE_BLUE]);
  shapeless(B.WOOL_GREEN, 1, [B.WOOL_WHITE, I.DYE_GREEN]);
  shaped(B.WOOL_WHITE, 1, ['SS', 'SS'], { S: I.STRING });
  shaped(B.JACK, 1, ['P', 'T'], { P: B.PUMPKIN, T: B.TORCH });
  // Механизмы
  shaped(B.LEVER, 1, ['S', 'C'], { S: I.STICK, C: B.COBBLE });
  shapeless(B.BUTTON, 1, [B.STONE]);
  shaped(B.PLATE, 1, ['SS'], { S: B.STONE });
  shaped(B.SPARK_TORCH, 1, ['R', 'S'], { R: I.SPARK_DUST, S: I.STICK });
  shaped(B.LAMP, 1, [' R ', 'RGR', ' R '], { R: I.SPARK_DUST, G: B.GLASS });
  shaped(B.PISTON, 1, ['PPP', 'CIC', 'CRC'], { P: B.PLANKS, C: B.COBBLE, I: I.IRON_INGOT, R: I.SPARK_DUST });

  // Плавка: вход → выход
  var SMELT = {};
  SMELT[B.IRON_ORE] = I.IRON_INGOT; SMELT[B.GOLD_ORE] = I.GOLD_INGOT; SMELT[B.SAND] = B.GLASS;
  SMELT[B.COBBLE] = B.STONE; SMELT[B.LOG] = I.CHARCOAL; SMELT[B.BIRCH_LOG] = I.CHARCOAL;
  SMELT[I.CLAY_BALL] = I.BRICK_ITEM; SMELT[B.CACTUS] = I.DYE_GREEN; SMELT[I.PORK_RAW] = I.PORK_COOKED;
  SMELT[I.BEEF_RAW] = I.BEEF_COOKED; SMELT[I.MUTTON_RAW] = I.MUTTON_COOKED; SMELT[I.CHICKEN_RAW] = I.CHICKEN_COOKED;
  SMELT[B.CLAY] = B.BRICK;

  // Подбор рецепта по сетке ids (w×h), пустые — 0
  function matchRecipe(grid, w, h) {
    var x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0, x, y;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) if (grid[y * w + x]) {
      n++; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
    }
    if (!n) return null;
    var bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    for (var r = 0; r < RECIPES.length; r++) {
      var rc = RECIPES[r];
      if (rc.shapeless) {
        if (rc.size !== n) continue;
        var used = [], ok = true;
        for (y = 0; y < h && ok; y++) for (x = 0; x < w && ok; x++) {
          var id = grid[y * w + x];
          if (!id) continue;
          var found = -1;
          for (var s = 0; s < rc.shapeless.length; s++) {
            if (used[s]) continue;
            if (rc.shapeless[s].indexOf(id) >= 0) { found = s; break; }
          }
          if (found < 0) ok = false; else used[found] = true;
        }
        if (ok) return rc;
        continue;
      }
      if (rc.w !== bw || rc.h !== bh) continue;
      for (var mirror = 0; mirror < 2; mirror++) {
        var good = true;
        for (y = 0; y < bh && good; y++) for (x = 0; x < bw && good; x++) {
          var ch = rc.rows[y].charAt(mirror ? bw - 1 - x : x);
          var g = grid[(y0 + y) * w + (x0 + x)];
          if (ch === ' ' || ch === '') { if (g) good = false; }
          else if (!g || rc.keys[ch].indexOf(g) < 0) good = false;
        }
        if (good) return rc;
      }
    }
    return null;
  }

  // Ингредиенты рецепта как список «вариантов» (для книги рецептов)
  function recipeNeeds(rc) {
    if (rc.shapeless) return rc.shapeless.slice();
    var out = [];
    rc.rows.forEach(function (row) {
      for (var i = 0; i < row.length; i++) { var ch = row.charAt(i); if (ch !== ' ') out.push(rc.keys[ch]); }
    });
    return out;
  }
  function recipeFits2x2(rc) { return rc.shapeless ? rc.size <= 4 : rc.w <= 2 && rc.h <= 2; }

  // Порядок палитры творческого режима
  var CREATIVE = [];
  BLOCKS.forEach(function (b, id) { if (ITEMS[id]) CREATIVE.push(id); });
  for (var iid = 256; iid < ITEMS.length; iid++) if (ITEMS[iid]) CREATIVE.push(iid);

  KC.B = B;
  KC.I = I;
  KC.BLOCKS = BLOCKS;
  KC.ITEMS = ITEMS;
  KC.OPAQUE = OPAQUE;
  KC.SOLID = SOLID;
  KC.OCCLUDE = OCCLUDE;
  KC.LIGHTBLOCK = LIGHTBLOCK;
  KC.REPLACEABLE = REPLACEABLE;
  KC.LIQUID = LIQUID;
  KC.EMIT = EMIT;
  KC.emission = emission;
  KC.toolId = toolId;
  KC.armorId = armorId;
  KC.canHarvest = canHarvest;
  KC.breakTime = breakTime;
  KC.drops = drops;
  KC.RECIPES = RECIPES;
  KC.SMELT = SMELT;
  KC.matchRecipe = matchRecipe;
  KC.recipeNeeds = recipeNeeds;
  KC.recipeFits2x2 = recipeFits2x2;
  KC.CREATIVE = CREATIVE;
  KC.DEFAULT_HOTBAR = [B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.PLANKS, B.LOG, B.GLASS, B.TORCH, B.WOOL_RED];
  KC.maxStack = function (id) { var it = ITEMS[id]; return it ? it.stack : 64; };
  KC.itemName = function (id) { var it = ITEMS[id]; return it ? it.name : '?'; };
})(window.KC = window.KC || {});
