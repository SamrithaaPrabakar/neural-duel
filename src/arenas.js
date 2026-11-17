// Campaign structure: 30 levels grouped into themed chapters of 10, each
// chapter reusing one painted arena backdrop (the same way a real fighting
// game reuses a handful of locations across many story levels, rather than
// painting 30 unique ones). Beating the current highest-unlocked level
// unlocks the next; progress is persisted (see persistence.js).

export const TOTAL_LEVELS = 30;

export const ARENAS = [
  { id: "china", name: "Imperial Palace", theme: "China", bg: "art/arenas/china.jpg" },
  { id: "greece", name: "Ruins of Olympus", theme: "Greece", bg: "art/arenas/greece.jpg" },
  { id: "japan", name: "Autumn Shrine", theme: "Japan", bg: "art/arenas/japan.jpg" },
];

const LEVELS_PER_CHAPTER = Math.ceil(TOTAL_LEVELS / ARENAS.length);

export function arenaForLevel(level) {
  const chapter = Math.min(ARENAS.length - 1, Math.floor((level - 1) / LEVELS_PER_CHAPTER));
  return ARENAS[chapter];
}

export function chapterProgress(level) {
  const idx = (level - 1) % LEVELS_PER_CHAPTER;
  return { stage: idx + 1, of: LEVELS_PER_CHAPTER };
}

// Difficulty curve across the campaign: early levels force the CPU's
// effective exploration rate UP (it plays looser, more beatable) regardless
// of how well-trained the shared Q-brain already is; late levels force it
// DOWN (it leans hard on its best-known move) and hand the CPU a few bonus
// stat points on top. The underlying Q-table is never touched — this only
// clamps the epsilon used for THIS fight's action selection, same trick the
// old practice/normal/hard picker used.
export function levelEpsilonClamp(level, baseEpsilon) {
  const t = (level - 1) / (TOTAL_LEVELS - 1); // 0 (level 1) -> 1 (level 30)
  const floor = 0.06 + (1 - t) * 0.5; // level 1 floor ~0.56, level 30 floor ~0.06
  const ceiling = 0.95 - t * 0.3; // level 1 ceiling ~0.95, level 30 ceiling ~0.65
  return Math.min(ceiling, Math.max(floor, baseEpsilon));
}

export function levelCpuBonusPoints(level) {
  return Math.floor((level - 1) / 5); // +1 stat point every 5 levels, up to +5
}

const imageCache = new Map();
export function loadArenaImage(arena) {
  if (!imageCache.has(arena.id)) {
    const img = new Image();
    img.src = arena.bg;
    imageCache.set(arena.id, img);
  }
  return imageCache.get(arena.id);
}
