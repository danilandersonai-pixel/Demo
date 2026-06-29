// Player + monster archetypes and factories. Pure data/construction.

export const MONSTERS = {
  fallen:   { name: 'Падший',  body: '#9bbd5a', dark: '#46622a', r: 0.30, hp: 13, dmg: 3,  speed: 2.7, range: 0.95, cd: 0.9, aggro: 6, xp: 5,  gold: [0, 4] },
  skeleton: { name: 'Скелет',  body: '#dfe3ea', dark: '#7d8492', r: 0.33, hp: 20, dmg: 5,  speed: 2.3, range: 1.0,  cd: 1.0, aggro: 7, xp: 9,  gold: [1, 6] },
  zombie:   { name: 'Зомби',   body: '#7e9356', dark: '#39471f', r: 0.37, hp: 34, dmg: 8,  speed: 1.4, range: 1.0,  cd: 1.3, aggro: 6, xp: 13, gold: [2, 9] },
  demon:    { name: 'Демон',   body: '#bf4a30', dark: '#5c1d11', r: 0.43, hp: 58, dmg: 13, speed: 1.9, range: 1.1,  cd: 1.1, aggro: 8, xp: 26, gold: [6, 18] },
};

export function spawnMonster(type, x, y, level) {
  const d = MONSTERS[type];
  const s = 1 + (level - 1) * 0.33; // difficulty scaling
  const hp = Math.round(d.hp * s);
  return {
    kind: 'monster', type, name: d.name,
    x, y, r: d.r, body: d.body, dark: d.dark,
    hp, maxHp: hp,
    dmg: Math.max(1, Math.round(d.dmg * s)),
    speed: d.speed, range: d.range,
    cd: d.cd, cdLeft: Math.random() * 0.5,
    aggro: d.aggro,
    xp: Math.round(d.xp * s),
    goldMin: d.gold[0], goldMax: Math.round(d.gold[1] * s),
    state: 'idle', path: null, pathI: 0,
    hitFlash: 0, facing: 1, bob: Math.random() * 6,
  };
}

export function makePlayer(x, y) {
  return {
    kind: 'player',
    x, y, r: 0.32, facing: 1,
    hp: 60, maxHp: 60,
    mana: 30, maxMana: 30,
    level: 1, xp: 0, xpNext: 30,
    dmgMin: 4, dmgMax: 8,
    speed: 3.3, range: 1.15,
    atkCd: 0.55, atkLeft: 0,
    spellDmgMin: 9, spellDmgMax: 15, spellCost: 6, spellRange: 7, spellCd: 0.5, spellLeft: 0,
    gold: 0, potions: 3,
    path: null, pathI: 0,
    target: null, // current monster target
    bob: 0, hitFlash: 0,
  };
}

// XP needed for the next level grows each level.
export function xpForLevel(level) { return Math.round(30 * Math.pow(1.5, level - 1)); }

export function levelUpPlayer(p) {
  p.level++;
  p.xp -= p.xpNext;
  p.xpNext = xpForLevel(p.level);
  p.maxHp += 12; p.hp = p.maxHp;
  p.maxMana += 5; p.mana = p.maxMana;
  p.dmgMin += 1; p.dmgMax += 2;
  p.spellDmgMin += 2; p.spellDmgMax += 3;
}
