// Weapon / shield / stat definitions, and the derivation of a Fighter's
// actual combat numbers from a chosen loadout. Keeping this in one place
// means both the human's loadout screen and the CPU's random pre-match
// loadout go through the exact same math.

export const WEAPONS = {
  blade: {
    id: "blade", name: "Blade", color: "#ffd23f",
    range: 62, lightDamage: 10, lightDuration: 360, lightActive: [110, 200],
    heavyDamage: 19, heavyDuration: 560, heavyActive: [260, 380],
    desc: "Balanced range and speed. No real weakness.",
  },
  spear: {
    id: "spear", name: "Spear", color: "#4fd6ff",
    range: 92, lightDamage: 8, lightDuration: 420, lightActive: [150, 240],
    heavyDamage: 17, heavyDuration: 620, heavyActive: [300, 420],
    desc: "Longest reach. Slower to recover.",
  },
  gauntlets: {
    id: "gauntlets", name: "Gauntlets", color: "#ff4fd8",
    range: 46, lightDamage: 6, lightDuration: 240, lightActive: [70, 140],
    heavyDamage: 14, heavyDuration: 440, heavyActive: [200, 300],
    desc: "Short range, very fast. Built for combos.",
  },
};

export const SHIELDS = {
  buckler: {
    id: "buckler", name: "Buckler", color: "#9ad1ff",
    blockMult: 0.3, moveMult: 1.0, parryWindow: 130, hasBlock: true, extraDash: false,
    desc: "Moderate block, generous parry window.",
  },
  tower: {
    id: "tower", name: "Tower Shield", color: "#c9a7ff",
    blockMult: 0.08, moveMult: 0.75, parryWindow: 60, hasBlock: true, extraDash: false,
    desc: "Blocks almost everything. Heavy — you move slower while holding it up.",
  },
  evasive: {
    id: "evasive", name: "Evasive (no shield)", color: "#7dffb0",
    blockMult: 1.0, moveMult: 1.0, parryWindow: 0, hasBlock: false, extraDash: true,
    desc: "No block at all. Instead: a second dash charge and faster dashes.",
  },
};

export const STAT_POOL = 6;
export const STAT_BASE = 2;
export const STAT_MIN = 1;
export const STAT_MAX = 5;

export function defaultStats() {
  return { power: 2, speed: 2, vitality: 2 };
}

export function statsPointsUsed(stats) {
  return stats.power + stats.speed + stats.vitality;
}

export function deriveCombatProfile(loadout) {
  const w = WEAPONS[loadout.weapon];
  const s = SHIELDS[loadout.shield];
  const { power, speed, vitality } = loadout.stats;

  const powerMult = 1 + (power - STAT_BASE) * 0.15;
  const speedMult = 1 + (speed - STAT_BASE) * 0.12;
  const maxHp = 100 + (vitality - STAT_BASE) * 15;

  return {
    weapon: w,
    shield: s,
    maxHp,
    moveSpeedMult: speedMult * s.moveMult,
    dashSpeedMult: speedMult * (s.extraDash ? 1.25 : 1.0),
    dashCharges: s.extraDash ? 2 : 1,
    attackRange: w.range,
    lightDamage: Math.round(w.lightDamage * powerMult),
    lightDuration: w.lightDuration,
    lightActive: w.lightActive,
    heavyDamage: Math.round(w.heavyDamage * powerMult),
    heavyDuration: w.heavyDuration,
    heavyActive: w.heavyActive,
    blockMult: s.blockMult,
    hasBlock: s.hasBlock,
    parryWindow: s.parryWindow,
    color: w.color,
    shieldColor: s.color,
  };
}

export function randomLoadout(rng = Math.random, excludeWeapon = null) {
  const allWeaponIds = Object.keys(WEAPONS);
  const weaponIds = excludeWeapon && allWeaponIds.length > 1
    ? allWeaponIds.filter((id) => id !== excludeWeapon)
    : allWeaponIds;
  const shieldIds = Object.keys(SHIELDS);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const stats = defaultStats();
  let remaining = STAT_POOL - statsPointsUsed(stats);
  const keys = ["power", "speed", "vitality"];
  while (remaining > 0) {
    const k = pick(keys);
    if (stats[k] < STAT_MAX) { stats[k]++; remaining--; }
  }
  return { weapon: pick(weaponIds), shield: pick(shieldIds), stats };
}
