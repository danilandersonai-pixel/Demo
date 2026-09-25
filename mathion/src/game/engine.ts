// Игровой движок Mathion.
// Все функции чистые: (state, …) → { state, events }. Никакого React, DOM или таймеров —
// время приходит снаружи через tick(dt), случайность — через rng.

import type {
  Battle,
  Blitz,
  BlitzElement,
  BlitzRecord,
  Element,
  Enemy,
  EngineResult,
  Essences,
  GameEvent,
  GameState,
  HuntTier,
  LogKind,
  PotionId,
  Rewards,
  Rng,
  SpellId,
  UpgradeId,
} from '../types';
import {
  BLITZ_BONUS_TIME,
  BLITZ_COMBO_CAP,
  BLITZ_CORRECT_PER_DIFFICULTY,
  BLITZ_MAX_DIFFICULTY,
  BLITZ_START_TIME,
  ELEMENTS,
  ELEMENT_META,
  FREEZE_DURATION,
  HEALTH_POTION_RATIO,
  HUNT_TIERS,
  LOG_LIMIT,
  MANA_POTION_AMOUNT,
  POTIONS,
  POTION_STACK,
  RECORDS_LIMIT,
  REGEN_RATIO,
  SPELLS,
  UPGRADES,
  codexChance,
  critChance,
  critMultiplier,
  emptyEssences,
  lensesBonus,
  levelDamageMultiplier,
  maxHp,
  maxMana,
  meditationCost,
  meteorDamage,
  shieldBlock,
  xpToNext,
} from './constants';
import {
  CHRONO_DAMAGE_BONUS,
  FROST_SHIELD_REGEN,
  MIRROR_RATIO,
  PHASE_ATTACK_BONUS,
  PHASE_SHIELD,
  POISON_DAMAGE,
  POISON_TURNS,
  RAGE_STEP,
  REGEN_RATIO_ENEMY,
  VOID_ONLY_PENALTY,
  createFloorBoss,
  createHuntEnemy,
  getFloor,
} from './enemies';
import { generateProblem, parseAnswer } from './problems';
import { clamp, pick, uid } from './utils';

// ---------------------------------------------------------------------------
// Транзакция
// ---------------------------------------------------------------------------

class Tx {
  state: GameState;
  readonly events: GameEvent[] = [];

  constructor(state: GameState) {
    this.state = state;
  }

  log(kind: LogKind, text: string): void {
    const entry = { id: uid(), ts: Date.now(), kind, text };
    this.state = { ...this.state, log: [entry, ...this.state.log].slice(0, LOG_LIMIT) };
  }

  emit(event: GameEvent): void {
    this.events.push(event);
  }

  get battle(): Battle {
    const battle = this.state.battle;
    if (!battle) throw new Error('Нет активного боя');
    return battle;
  }

  setBattle(patch: Partial<Battle>): void {
    this.state = { ...this.state, battle: { ...this.battle, ...patch } };
  }

  setEnemy(patch: Partial<Enemy>): void {
    this.setBattle({ enemy: { ...this.battle.enemy, ...patch } });
  }

  setPlayer(patch: Partial<GameState['player']>): void {
    this.state = { ...this.state, player: { ...this.state.player, ...patch } };
  }

  addStats(patch: Partial<GameState['stats']>): void {
    this.state = { ...this.state, stats: { ...this.state.stats, ...patch } };
  }

  result(): EngineResult {
    return { state: this.state, events: this.events };
  }
}

function unchanged(state: GameState): EngineResult {
  return { state, events: [] };
}

function isBattleActive(state: GameState): boolean {
  return state.battle !== null && state.battle.status === 'active';
}

function isBlitzActive(state: GameState): boolean {
  return state.blitz !== null && state.blitz.status === 'active';
}

function addEssences(base: Essences, add: Partial<Essences>, sign = 1): Essences {
  const next = { ...base };
  for (const el of ELEMENTS) next[el] = Math.max(0, next[el] + sign * (add[el] ?? 0));
  return next;
}

function hasEssences(have: Essences, need: Partial<Essences>): boolean {
  return ELEMENTS.every((el) => have[el] >= (need[el] ?? 0));
}

function essenceText(essences: Partial<Essences>): string {
  return ELEMENTS.filter((el) => (essences[el] ?? 0) > 0)
    .map((el) => `${essences[el]} ${ELEMENT_META[el].name.toLowerCase()}`)
    .join(', ');
}

// ---------------------------------------------------------------------------
// Герой
// ---------------------------------------------------------------------------

function gainXp(tx: Tx, amount: number): void {
  let { level, xp } = tx.state.player;
  xp += amount;
  let leveled = false;
  while (xp >= xpToNext(level)) {
    xp -= xpToNext(level);
    level += 1;
    leveled = true;
    tx.emit({ type: 'levelUp', level });
    const unlock = level === ELEMENT_META.void.unlockLevel ? ' Открыта Высшая Магия Пустоты!' : '';
    tx.log('level', `Новый уровень алхимика: ${level}! Здоровье и мана восстановлены, урон вырос.${unlock}`);
  }
  tx.setPlayer({ level, xp });
  if (leveled) {
    tx.setPlayer({ hp: maxHp(tx.state), mana: maxMana(tx.state) });
  }
}

function healPlayer(tx: Tx, amount: number): number {
  const player = tx.state.player;
  const healed = Math.max(0, Math.min(amount, maxHp(tx.state) - player.hp));
  if (healed > 0) {
    tx.setPlayer({ hp: player.hp + healed });
    tx.emit({ type: 'heal', amount: healed });
  }
  return healed;
}

function addMana(tx: Tx, amount: number): number {
  const player = tx.state.player;
  const gained = Math.max(0, Math.min(amount, maxMana(tx.state) - player.mana));
  if (gained > 0) {
    tx.setPlayer({ mana: player.mana + gained });
    tx.emit({ type: 'mana', amount: gained });
  }
  return gained;
}

/** Наносит урон герою. Если бой идёт и HP кончилось — поражение. */
function hurtPlayer(tx: Tx, amount: number, reason: 'wrong' | 'timeout' | 'poison' | 'mirror'): void {
  if (amount <= 0) return;
  const hp = Math.max(0, tx.state.player.hp - amount);
  tx.setPlayer({ hp });
  tx.emit({ type: 'playerHit', amount, reason });
  if (tx.state.battle && tx.state.battle.status === 'active') {
    tx.setBattle({ damageTaken: tx.battle.damageTaken + amount });
    if (hp <= 0) defeat(tx);
  }
}

// ---------------------------------------------------------------------------
// Бой: подготовка
// ---------------------------------------------------------------------------

/** Время на пример с учётом школы, линз и особенностей врага. */
export function timeLimitFor(state: GameState, enemy: Enemy, element: Element): number {
  let seconds = enemy.attackTime + ELEMENT_META[element].extraTime + lensesBonus(state.upgrades.lenses);
  if (enemy.traits.includes('heat')) seconds -= 2;
  if (enemy.traits.includes('chrono')) seconds = seconds / 2;
  return Math.max(4, seconds) * 1000;
}

function problemFor(enemy: Enemy, element: Element, rng: Rng) {
  return generateProblem(element, enemy.level, rng, { evenOnly: enemy.traits.includes('even_only') });
}

export function isElementUnlocked(state: GameState, element: Element): boolean {
  return state.player.level >= ELEMENT_META[element].unlockLevel;
}

function defaultElement(state: GameState, enemy: Enemy): Element {
  if (enemy.weakness && isElementUnlocked(state, enemy.weakness)) return enemy.weakness;
  return state.battle?.element ?? 'earth';
}

function openBattle(tx: Tx, enemy: Enemy, mode: Battle['mode'], floor: number | null, huntTier: HuntTier | null, rng: Rng): void {
  const element = defaultElement(tx.state, enemy);
  const timeLimit = timeLimitFor(tx.state, enemy, element);
  const battle: Battle = {
    mode,
    floor,
    huntTier,
    enemy,
    element,
    problem: problemFor(enemy, element, rng),
    timeLeft: timeLimit,
    timeLimit,
    freezeLeft: 0,
    combo: 0,
    maxCombo: 0,
    poisonTurns: 0,
    turn: 1,
    correct: 0,
    wrong: 0,
    damageDealt: 0,
    damageTaken: 0,
    status: 'active',
    rewards: null,
    goldLost: 0,
  };
  tx.state = { ...tx.state, battle };
}

export function startHunt(state: GameState, tier: HuntTier, rng: Rng): EngineResult {
  if (isBattleActive(state) || isBlitzActive(state)) return unchanged(state);
  if (state.player.hp <= 0) return unchanged(state);
  const tx = new Tx(state);
  const level = Math.max(1, state.player.level + HUNT_TIERS[tier].levelDelta);
  const enemy = createHuntEnemy(level, rng);
  openBattle(tx, enemy, 'hunt', null, tier, rng);
  tx.log('system', `${HUNT_TIERS[tier].label}: навстречу выходит ${enemy.name} (ур. ${enemy.level}).`);
  return tx.result();
}

export function startFloor(state: GameState, floor: number, rng: Rng): EngineResult {
  if (isBattleActive(state) || isBlitzActive(state)) return unchanged(state);
  if (floor < 1 || floor > 10 || floor > state.campaignCleared + 1) return unchanged(state);
  const tx = new Tx(state);
  const enemy = createFloorBoss(floor);
  openBattle(tx, enemy, 'campaign', floor, null, rng);
  const boss = getFloor(floor);
  tx.log('boss', `Этаж ${floor}. ${enemy.name} преграждает путь! ${boss.rule}`);
  return tx.result();
}

// ---------------------------------------------------------------------------
// Бой: ходы
// ---------------------------------------------------------------------------

/** Следующий ход: новый пример, сброс таймера, тик яда. */
function nextTurn(tx: Tx, rng: Rng): void {
  const battle = tx.battle;
  tx.setBattle({
    problem: problemFor(battle.enemy, battle.element, rng),
    timeLimit: timeLimitFor(tx.state, battle.enemy, battle.element),
    timeLeft: timeLimitFor(tx.state, battle.enemy, battle.element),
    turn: battle.turn + 1,
  });
  if (battle.poisonTurns > 0) {
    tx.setBattle({ poisonTurns: battle.poisonTurns - 1 });
    tx.log('hurt', `Яд жжёт вены: −${POISON_DAMAGE} HP (осталось ходов: ${battle.poisonTurns - 1}).`);
    hurtPlayer(tx, POISON_DAMAGE, 'poison');
  }
}

/** Контратака врага за ошибку или истёкшее время. */
function enemyAttack(tx: Tx, reason: 'wrong' | 'timeout'): void {
  const battle = tx.battle;
  const enemy = battle.enemy;
  const raw = enemy.attack + enemy.attackBonus;
  const block = shieldBlock(tx.state.upgrades.shield);
  const damage = Math.max(1, Math.round(raw * (1 - block)));
  const blocked = raw - damage;

  const cause = reason === 'timeout' ? 'Время вышло!' : 'Ошибка в формуле!';
  tx.log('hurt', `${cause} ${enemy.name} атакует: −${damage} HP${blocked > 0 ? ` (Ментальный щит поглотил ${blocked})` : ''}.`);

  if (enemy.traits.includes('rage')) {
    tx.setEnemy({ attackBonus: enemy.attackBonus + RAGE_STEP });
    tx.log('boss', `${enemy.name} впадает в ярость: следующая атака +${RAGE_STEP}.`);
  }
  if (enemy.traits.includes('frost_shield')) {
    const current = tx.battle.enemy;
    const shield = Math.min(current.maxShield + 40, current.shield + FROST_SHIELD_REGEN);
    tx.setEnemy({ shield });
    tx.emit({ type: 'enemyShield', amount: FROST_SHIELD_REGEN });
    tx.log('boss', `${enemy.name} наращивает ледяной панцирь: щит ${shield}.`);
  }
  if (enemy.traits.includes('regen')) {
    const current = tx.battle.enemy;
    const healed = Math.min(current.maxHp - current.hp, Math.round(current.maxHp * REGEN_RATIO_ENEMY));
    if (healed > 0) {
      tx.setEnemy({ hp: current.hp + healed });
      tx.emit({ type: 'enemyHeal', amount: healed });
      tx.log('boss', `${enemy.name} впитывает вашу ошибку и восстанавливает ${healed} HP.`);
    }
  }
  if (enemy.traits.includes('poison')) {
    tx.setBattle({ poisonTurns: POISON_TURNS });
    tx.log('boss', `${enemy.name} активировал яд! Отравление на ${POISON_TURNS} хода.`);
  }

  tx.setBattle({ combo: 0 });
  hurtPlayer(tx, damage, reason);
}

interface HitOptions {
  forcedCrit?: boolean;
  /** Бомба-автоответ: фиксированный бонус скорости. */
  auto?: boolean;
}

/** Правильный ответ: урон, мана, эссенции, комбо. */
function landHit(tx: Tx, rng: Rng, options: HitOptions = {}): void {
  const battle = tx.battle;
  const enemy = battle.enemy;
  const element = battle.element;
  const meta = ELEMENT_META[element];
  const player = tx.state.player;

  const speed = options.auto ? 1.2 : 1 + 0.4 * clamp(battle.timeLeft / battle.timeLimit, 0, 1);
  const comboMult = 1 + Math.min(battle.combo, 10) * 0.05;
  let affinity = 1;
  if (enemy.weakness === element) affinity = 1.5;
  else if (enemy.resist === element) affinity = 0.5;
  if (enemy.traits.includes('void_only') && element !== 'void') affinity *= VOID_ONLY_PENALTY;
  const chrono = enemy.traits.includes('chrono') ? CHRONO_DAMAGE_BONUS : 1;
  const crit = options.forcedCrit === true || rng() < critChance(battle.combo);
  const critMult = crit ? critMultiplier(tx.state.upgrades.stone) : 1;

  const damage = Math.max(
    1,
    Math.round(meta.baseDamage * levelDamageMultiplier(player.level) * speed * comboMult * affinity * chrono * critMult),
  );
  const absorbed = Math.min(enemy.shield, damage);
  const hp = Math.max(0, enemy.hp - (damage - absorbed));
  const combo = battle.combo + 1;

  tx.setEnemy({ hp, shield: enemy.shield - absorbed });
  tx.setBattle({
    combo,
    maxCombo: Math.max(battle.maxCombo, combo),
    correct: battle.correct + 1,
    damageDealt: battle.damageDealt + damage,
  });
  tx.emit({ type: 'cast', element });
  tx.emit({ type: 'enemyHit', amount: damage, shield: absorbed, crit, element });

  const affinityNote = affinity > 1 ? ' Уязвимость!' : affinity < 1 ? ' Сопротивление…' : '';
  const shieldNote = absorbed > 0 ? ` (щит поглотил ${absorbed})` : '';
  tx.log(
    crit ? 'crit' : 'attack',
    `Вы применили ${meta.accusative} (${battle.problem.solution}).${crit ? ' Критический удар!' : ''}${affinityNote} ${enemy.name} получает ${damage} урона${shieldNote}.${combo >= 3 ? ` Комбо ×${combo}.` : ''}`,
  );

  // Статистика
  const stats = tx.state.stats;
  tx.addStats({
    totalDamage: stats.totalDamage + damage,
    bestHit: Math.max(stats.bestHit, damage),
    crits: stats.crits + (crit ? 1 : 0),
    byElement: { ...stats.byElement, [element]: { ...stats.byElement[element], correct: stats.byElement[element].correct + 1 } },
  });

  // Мана и эссенции
  addMana(tx, meta.mana + tx.state.upgrades.crystal * 3);
  let essence = 1 + (crit ? 1 : 0);
  if (rng() < codexChance(tx.state.upgrades.codex)) essence *= 2;
  tx.setPlayer({ essences: addEssences(tx.state.player.essences, { [element]: essence }) });

  // Враг повержен — отражение и фазы уже не важны.
  if (tx.battle.enemy.hp <= 0) {
    victory(tx, rng);
    return;
  }

  // Отражение урона
  if (enemy.traits.includes('mirror')) {
    const reflected = Math.max(1, Math.round(damage * MIRROR_RATIO));
    tx.log('hurt', `${enemy.name} отражает ${reflected} урона обратно!`);
    hurtPlayer(tx, reflected, 'mirror');
    if (tx.battle.status !== 'active') return;
  }

  // Вторая фаза
  const after = tx.battle.enemy;
  if (after.traits.includes('phase') && !after.enraged && after.hp <= after.maxHp / 2) {
    tx.setEnemy({ enraged: true, shield: PHASE_SHIELD, maxShield: Math.max(after.maxShield, PHASE_SHIELD), attackBonus: after.attackBonus + PHASE_ATTACK_BONUS });
    tx.emit({ type: 'enemyShield', amount: PHASE_SHIELD });
    tx.log('boss', `${after.name} входит во вторую фазу! Щит ${PHASE_SHIELD}, атака +${PHASE_ATTACK_BONUS}.`);
  }

  nextTurn(tx, rng);
}

function registerWrong(tx: Tx): void {
  const battle = tx.battle;
  const stats = tx.state.stats;
  tx.setBattle({ wrong: battle.wrong + 1 });
  tx.addStats({
    byElement: {
      ...stats.byElement,
      [battle.element]: { ...stats.byElement[battle.element], wrong: stats.byElement[battle.element].wrong + 1 },
    },
  });
  tx.emit({ type: 'wrong' });
}

export function submitAnswer(state: GameState, input: string, rng: Rng): EngineResult {
  if (!isBattleActive(state)) return unchanged(state);
  const value = parseAnswer(input);
  if (value === null) return unchanged(state);
  const tx = new Tx(state);
  const battle = tx.battle;

  if (battle.enemy.traits.includes('even_only') && value % 2 !== 0) {
    tx.log('boss', `${battle.enemy.name} отвергают нечётное число ${value}! (${battle.problem.solution})`);
    registerWrong(tx);
    enemyAttack(tx, 'wrong');
  } else if (value === battle.problem.answer) {
    landHit(tx, rng);
    return tx.result();
  } else {
    tx.log('hurt', `Неверно: ${value}. Правильный ответ — ${battle.problem.solution}.`);
    registerWrong(tx);
    enemyAttack(tx, 'wrong');
  }
  if (tx.state.battle?.status === 'active') nextTurn(tx, rng);
  return tx.result();
}

/** Смена школы магии: новый пример, но таймер продолжает идти — пропустить сложный пример не выйдет. */
export function selectElement(state: GameState, element: Element, rng: Rng): EngineResult {
  if (!isBattleActive(state) || !isElementUnlocked(state, element)) return unchanged(state);
  const battle = state.battle as Battle;
  if (battle.element === element) return unchanged(state);
  const tx = new Tx(state);
  const newLimit = timeLimitFor(state, battle.enemy, element);
  tx.setBattle({
    element,
    problem: problemFor(battle.enemy, element, rng),
    timeLimit: newLimit,
    timeLeft: Math.min(battle.timeLeft, newLimit),
  });
  return tx.result();
}

// ---------------------------------------------------------------------------
// Бой: завершение
// ---------------------------------------------------------------------------

function victory(tx: Tx, rng: Rng): void {
  const battle = tx.battle;
  const enemy = battle.enemy;
  let rewards: Rewards;

  if (battle.mode === 'campaign' && battle.floor !== null) {
    const boss = getFloor(battle.floor);
    const firstClear = battle.floor > tx.state.campaignCleared;
    const essences = firstClear
      ? { earth: 2, fire: 2, water: 2, void: 3 }
      : { earth: 1, fire: 1, water: 1, void: 1 };
    rewards = {
      gold: firstClear ? boss.firstClearGold : Math.round(boss.firstClearGold * 0.4),
      xp: firstClear ? 40 + enemy.level * 15 : 20 + enemy.level * 7,
      essences,
      firstClear,
    };
    if (firstClear) tx.state = { ...tx.state, campaignCleared: battle.floor };
    tx.addStats({ bossesSlain: tx.state.stats.bossesSlain + 1 });
  } else {
    const tier = HUNT_TIERS[battle.huntTier ?? 'normal'];
    const essences = emptyEssences();
    essences[pick(rng, ELEMENTS)] += 1;
    if (enemy.weakness) essences[enemy.weakness] += 1;
    rewards = {
      gold: Math.round((12 + enemy.level * 6) * tier.reward),
      xp: Math.round((18 + enemy.level * 9) * tier.reward),
      essences,
      firstClear: false,
    };
  }

  tx.setBattle({ status: 'victory', rewards, freezeLeft: 0 });
  tx.setPlayer({
    gold: tx.state.player.gold + rewards.gold,
    essences: addEssences(tx.state.player.essences, rewards.essences),
  });
  tx.addStats({ battlesWon: tx.state.stats.battlesWon + 1 });
  tx.emit({ type: 'victory' });
  tx.log(
    'victory',
    `Победа! ${enemy.name} повержен. Награда: ${rewards.gold} золота, ${rewards.xp} опыта, эссенции: ${essenceText(rewards.essences)}.${
      rewards.firstClear ? ' Этаж покорён впервые!' : ''
    }`,
  );
  gainXp(tx, rewards.xp);
  const restored = healPlayer(tx, Math.round(maxHp(tx.state) * 0.3));
  if (restored > 0) tx.log('heal', `Передышка после боя: +${restored} HP.`);
}

function defeat(tx: Tx): void {
  const battle = tx.battle;
  const goldLost = Math.floor(tx.state.player.gold * 0.1);
  tx.setBattle({ status: 'defeat', goldLost, freezeLeft: 0 });
  tx.setPlayer({ gold: tx.state.player.gold - goldLost, hp: 0 });
  tx.addStats({ battlesLost: tx.state.stats.battlesLost + 1 });
  tx.emit({ type: 'defeat' });
  tx.log('defeat', `Поражение… ${battle.enemy.name} одолел вас. Потеряно ${goldLost} золота.`);
}

/** Закрыть экран итогов боя. После поражения герой приходит в себя с половиной здоровья. */
export function closeBattle(state: GameState): EngineResult {
  if (!state.battle || state.battle.status === 'active') return unchanged(state);
  const tx = new Tx({ ...state, battle: null });
  if (state.battle.status === 'defeat') {
    tx.setPlayer({ hp: Math.round(maxHp(tx.state) * 0.5) });
    tx.log('system', 'Вы очнулись в лаборатории. Здоровье восстановлено наполовину.');
  }
  return tx.result();
}

/** Отступление: без награды, но с потерей 5% золота. */
export function fleeBattle(state: GameState): EngineResult {
  if (!isBattleActive(state)) return unchanged(state);
  const battle = state.battle as Battle;
  const tx = new Tx(state);
  const lost = Math.floor(state.player.gold * 0.05);
  tx.setPlayer({ gold: state.player.gold - lost });
  tx.state = { ...tx.state, battle: null };
  tx.log('system', `Вы отступили от ${battle.enemy.name}${lost > 0 ? `, обронив ${lost} золота` : ''}.`);
  return tx.result();
}

// ---------------------------------------------------------------------------
// Время
// ---------------------------------------------------------------------------

/** Продвигает таймеры боя и блица на dt миллисекунд. */
export function tick(state: GameState, dt: number, rng: Rng): EngineResult {
  if (dt <= 0) return unchanged(state);

  if (isBattleActive(state)) {
    const battle = state.battle as Battle;
    const tx = new Tx(state);
    if (battle.freezeLeft > 0) {
      const freezeLeft = Math.max(0, battle.freezeLeft - dt);
      tx.setBattle({ freezeLeft });
      if (freezeLeft === 0) tx.log('system', 'Действие Зелья заморозки закончилось — время снова течёт.');
      return tx.result();
    }
    const timeLeft = battle.timeLeft - dt;
    if (timeLeft > 0) {
      tx.setBattle({ timeLeft });
      return tx.result();
    }
    tx.setBattle({ timeLeft: 0 });
    registerWrong(tx);
    enemyAttack(tx, 'timeout');
    if (tx.state.battle?.status === 'active') nextTurn(tx, rng);
    return tx.result();
  }

  if (isBlitzActive(state)) {
    const blitz = state.blitz as Blitz;
    const timeLeft = blitz.timeLeft - dt;
    const next = { ...state, blitz: { ...blitz, timeLeft: Math.max(0, timeLeft), elapsed: blitz.elapsed + dt } };
    if (timeLeft > 0) return { state: next, events: [] };
    return finishBlitz(next);
  }

  return unchanged(state);
}

// ---------------------------------------------------------------------------
// Зелья и заклинания
// ---------------------------------------------------------------------------

export function usePotion(state: GameState, id: PotionId, rng: Rng): EngineResult {
  if (state.potions[id] <= 0 || isBlitzActive(state)) return unchanged(state);
  const meta = POTIONS[id];
  const inBattle = isBattleActive(state);
  if (meta.battleOnly && !inBattle) return unchanged(state);

  const tx = new Tx(state);
  if (id === 'health' && tx.state.player.hp >= maxHp(tx.state)) {
    tx.log('system', 'Здоровье и так полное — зелье не потрачено.');
    return tx.result();
  }
  if (id === 'mana' && tx.state.player.mana >= maxMana(tx.state)) {
    tx.log('system', 'Мана и так полная — эликсир не потрачен.');
    return tx.result();
  }

  tx.state = {
    ...tx.state,
    potions: { ...tx.state.potions, [id]: tx.state.potions[id] - 1 },
  };
  tx.addStats({ potionsUsed: tx.state.stats.potionsUsed + 1 });
  tx.emit({ type: 'potion', id });

  if (id === 'health') {
    const healed = healPlayer(tx, Math.round(maxHp(tx.state) * HEALTH_POTION_RATIO));
    tx.log('heal', `Вы выпили ${meta.name}: +${healed} HP.`);
  } else if (id === 'mana') {
    const gained = addMana(tx, MANA_POTION_AMOUNT);
    tx.log('heal', `Вы выпили ${meta.name}: +${gained} маны.`);
  } else if (id === 'freeze') {
    tx.setBattle({ freezeLeft: tx.battle.freezeLeft + FREEZE_DURATION });
    tx.log('system', `Время застыло! Таймер врага остановлен на ${FREEZE_DURATION / 1000} секунд.`);
  } else {
    tx.log('crit', `Бомба-автоответ взрывается формулами: ${tx.battle.problem.solution}!`);
    landHit(tx, rng, { forcedCrit: true, auto: true });
  }
  return tx.result();
}

export function isSpellUnlocked(state: GameState, id: SpellId): boolean {
  return state.player.level >= SPELLS[id].unlockLevel;
}

export function castSpell(state: GameState, id: SpellId, rng: Rng): EngineResult {
  const spell = SPELLS[id];
  if (!isSpellUnlocked(state, id) || state.player.mana < spell.mana || isBlitzActive(state)) return unchanged(state);
  const inBattle = isBattleActive(state);
  if (id !== 'regen' && !inBattle) return unchanged(state);

  const tx = new Tx(state);
  if (id === 'regen' && tx.state.player.hp >= maxHp(tx.state)) {
    tx.log('system', 'Здоровье полное — руна не нужна.');
    return tx.result();
  }
  if (id === 'shatter' && tx.battle.enemy.shield <= 0) {
    tx.log('system', 'У врага нет щита — дробить нечего.');
    return tx.result();
  }

  tx.setPlayer({ mana: tx.state.player.mana - spell.mana });
  tx.addStats({ spellsCast: tx.state.stats.spellsCast + 1 });

  if (id === 'regen') {
    const healed = healPlayer(tx, Math.round(maxHp(tx.state) * REGEN_RATIO));
    tx.log('heal', `${spell.name} сияет зелёным: +${healed} HP.`);
    return tx.result();
  }

  const enemy = tx.battle.enemy;
  tx.emit({ type: 'cast', element: spell.element });
  if (id === 'shatter') {
    tx.emit({ type: 'enemyHit', amount: 0, shield: enemy.shield, crit: false, element: 'water' });
    tx.setEnemy({ shield: 0 });
    tx.log('attack', `${spell.name} раскалывает щит врага (−${enemy.shield})!`);
    return tx.result();
  }

  // Метеор: урон мимо щита
  let damage = meteorDamage(tx.state.player.level);
  if (enemy.traits.includes('void_only')) damage = Math.round(damage * VOID_ONLY_PENALTY);
  const hp = Math.max(0, enemy.hp - damage);
  tx.setEnemy({ hp });
  tx.setBattle({ damageDealt: tx.battle.damageDealt + damage });
  tx.addStats({ totalDamage: tx.state.stats.totalDamage + damage, bestHit: Math.max(tx.state.stats.bestHit, damage) });
  tx.emit({ type: 'enemyHit', amount: damage, shield: 0, crit: false, element: 'fire' });
  tx.log('attack', `${spell.name} обрушивается на ${enemy.name}: ${damage} урона сквозь щит!`);
  if (hp <= 0) victory(tx, rng);
  return tx.result();
}

// ---------------------------------------------------------------------------
// Лаборатория
// ---------------------------------------------------------------------------

export function canBuyUpgrade(state: GameState, id: UpgradeId): { ok: boolean; reason: string | null } {
  const meta = UPGRADES[id];
  const level = state.upgrades[id];
  if (level >= meta.maxLevel) return { ok: false, reason: 'Максимальный уровень' };
  if (meta.requires && state.upgrades[meta.requires.id] < meta.requires.level) {
    return { ok: false, reason: `Нужно: ${UPGRADES[meta.requires.id].name} ${meta.requires.level}` };
  }
  const cost = meta.cost(level + 1);
  if (state.player.gold < cost.gold) return { ok: false, reason: 'Не хватает золота' };
  if (!hasEssences(state.player.essences, cost.essences)) return { ok: false, reason: 'Не хватает эссенций' };
  return { ok: true, reason: null };
}

export function buyUpgrade(state: GameState, id: UpgradeId): EngineResult {
  if (!canBuyUpgrade(state, id).ok) return unchanged(state);
  const meta = UPGRADES[id];
  const level = state.upgrades[id] + 1;
  const cost = meta.cost(level);
  const tx = new Tx(state);
  tx.setPlayer({ gold: state.player.gold - cost.gold, essences: addEssences(state.player.essences, cost.essences, -1) });
  tx.state = { ...tx.state, upgrades: { ...tx.state.upgrades, [id]: level } };
  if (id === 'amulet') tx.setPlayer({ hp: tx.state.player.hp + 20 });
  tx.log('craft', `Лаборатория: «${meta.name}» улучшен до уровня ${level}. ${meta.effect(level)}.`);
  return tx.result();
}

export function canCraft(state: GameState, id: PotionId): { ok: boolean; reason: string | null } {
  const meta = POTIONS[id];
  if (state.potions[id] >= POTION_STACK) return { ok: false, reason: `Максимум ${POTION_STACK}` };
  if (state.player.gold < meta.gold) return { ok: false, reason: 'Не хватает золота' };
  if (!hasEssences(state.player.essences, meta.essences)) return { ok: false, reason: 'Не хватает эссенций' };
  return { ok: true, reason: null };
}

export function craftPotion(state: GameState, id: PotionId): EngineResult {
  if (!canCraft(state, id).ok) return unchanged(state);
  const meta = POTIONS[id];
  const tx = new Tx(state);
  tx.setPlayer({ gold: state.player.gold - meta.gold, essences: addEssences(state.player.essences, meta.essences, -1) });
  tx.state = { ...tx.state, potions: { ...tx.state.potions, [id]: tx.state.potions[id] + 1 } };
  tx.log('craft', `Сварено: ${meta.name}. В запасе: ${tx.state.potions[id]}.`);
  return tx.result();
}

export function meditate(state: GameState): EngineResult {
  if (isBattleActive(state) || isBlitzActive(state)) return unchanged(state);
  const cost = meditationCost(state.player.level);
  const full = state.player.hp >= maxHp(state) && state.player.mana >= maxMana(state);
  if (full || state.player.gold < cost) return unchanged(state);
  const tx = new Tx(state);
  tx.setPlayer({ gold: state.player.gold - cost });
  const healed = healPlayer(tx, maxHp(tx.state));
  const mana = addMana(tx, maxMana(tx.state));
  tx.log('heal', `Медитация у горна (−${cost} золота): +${healed} HP, +${mana} маны.`);
  return tx.result();
}

// ---------------------------------------------------------------------------
// Математический Блиц
// ---------------------------------------------------------------------------

function blitzElement(state: GameState, choice: BlitzElement, rng: Rng): Element {
  if (choice !== 'chaos') return choice;
  const available = ELEMENTS.filter((el) => isElementUnlocked(state, el));
  return pick(rng, available);
}

function blitzDifficulty(correct: number): number {
  return Math.min(BLITZ_MAX_DIFFICULTY, 1 + Math.floor(correct / BLITZ_CORRECT_PER_DIFFICULTY));
}

export function startBlitz(state: GameState, choice: BlitzElement, rng: Rng): EngineResult {
  if (isBattleActive(state) || isBlitzActive(state)) return unchanged(state);
  if (choice !== 'chaos' && !isElementUnlocked(state, choice)) return unchanged(state);
  const tx = new Tx(state);
  const blitz: Blitz = {
    element: choice,
    status: 'active',
    timeLeft: BLITZ_START_TIME,
    elapsed: 0,
    score: 0,
    correct: 0,
    wrong: 0,
    combo: 0,
    maxCombo: 0,
    problem: generateProblem(blitzElement(state, choice, rng), 1, rng),
    tally: emptyEssences(),
    rewards: null,
    recordRank: null,
  };
  tx.state = { ...tx.state, blitz };
  tx.log('system', `Математический Блиц начался! ${BLITZ_START_TIME / 1000} секунд, +${BLITZ_BONUS_TIME / 1000} с за каждый верный ответ.`);
  return tx.result();
}

export function submitBlitz(state: GameState, input: string, rng: Rng): EngineResult {
  if (!isBlitzActive(state)) return unchanged(state);
  const value = parseAnswer(input);
  if (value === null) return unchanged(state);
  const blitz = state.blitz as Blitz;
  const events: GameEvent[] = [];

  if (value === blitz.problem.answer) {
    const element = blitz.problem.element;
    const points = Math.round(ELEMENT_META[element].blitzPoints * blitz.problem.difficulty * (1 + Math.min(blitz.combo, BLITZ_COMBO_CAP) * 0.1));
    const correct = blitz.correct + 1;
    const combo = blitz.combo + 1;
    events.push({ type: 'blitzPoints', points, bonusTime: BLITZ_BONUS_TIME });
    return {
      state: {
        ...state,
        blitz: {
          ...blitz,
          score: blitz.score + points,
          correct,
          combo,
          maxCombo: Math.max(blitz.maxCombo, combo),
          timeLeft: blitz.timeLeft + BLITZ_BONUS_TIME,
          tally: { ...blitz.tally, [element]: blitz.tally[element] + 1 },
          problem: generateProblem(blitzElement(state, blitz.element, rng), blitzDifficulty(correct), rng),
        },
      },
      events,
    };
  }

  events.push({ type: 'wrong' });
  return {
    state: {
      ...state,
      blitz: {
        ...blitz,
        wrong: blitz.wrong + 1,
        combo: 0,
        problem: generateProblem(blitzElement(state, blitz.element, rng), blitzDifficulty(blitz.correct), rng),
      },
    },
    events,
  };
}

function finishBlitz(state: GameState): EngineResult {
  const blitz = state.blitz as Blitz;
  const tx = new Tx(state);
  const essences = emptyEssences();
  for (const el of ELEMENTS) essences[el] = Math.floor(blitz.tally[el] / 3);
  const gold = Math.floor(blitz.score / 15);

  let recordRank: number | null = null;
  let records = state.records;
  if (blitz.score > 0) {
    const record: BlitzRecord = {
      id: uid(),
      score: blitz.score,
      correct: blitz.correct,
      wrong: blitz.wrong,
      maxCombo: blitz.maxCombo,
      element: blitz.element,
      date: Date.now(),
    };
    records = [...state.records, record].sort((a, b) => b.score - a.score || a.date - b.date).slice(0, RECORDS_LIMIT);
    const index = records.findIndex((r) => r.id === record.id);
    recordRank = index >= 0 ? index + 1 : null;
  }

  tx.state = {
    ...tx.state,
    records,
    blitz: { ...blitz, status: 'over', timeLeft: 0, rewards: { gold, essences }, recordRank },
  };
  tx.setPlayer({ gold: tx.state.player.gold + gold, essences: addEssences(tx.state.player.essences, essences) });
  const essenceNote = essenceText(essences);
  tx.log(
    recordRank === 1 ? 'victory' : 'loot',
    `Блиц окончен: ${blitz.score} очков, ${blitz.correct} верных, лучшее комбо ×${blitz.maxCombo}. Награда: ${gold} золота${
      essenceNote ? `, эссенции: ${essenceNote}` : ''
    }.${recordRank === 1 ? ' Новый личный рекорд!' : recordRank ? ` Место в рекордах: ${recordRank}.` : ''}`,
  );
  if (recordRank === 1) tx.emit({ type: 'victory' });
  return tx.result();
}

/** Досрочно завершить блиц (результат засчитывается). */
export function endBlitz(state: GameState): EngineResult {
  if (!isBlitzActive(state)) return unchanged(state);
  return finishBlitz(state);
}

export function closeBlitz(state: GameState): EngineResult {
  if (!state.blitz || state.blitz.status !== 'over') return unchanged(state);
  return { state: { ...state, blitz: null }, events: [] };
}

export function clearLog(state: GameState): EngineResult {
  const tx = new Tx({ ...state, log: [] });
  tx.log('system', 'Свиток очищен.');
  return tx.result();
}
