// Campaign structure: 30 levels, cycling through the 3 arenas one level at
// a time (level 1 Greece, 2 China, 3 Japan, 4 Greece, ...) rather than in
// big 10-level blocks. Beating the current highest-unlocked level unlocks
// the next; progress is persisted (see persistence.js).
//
// Each arena's `bg` is a real illustrated backdrop (see main.js's
// drawArena), layered with a procedural readability band, drifting embers,
// and a ground rim so the silhouette fighters stay legible in front of it
// regardless of how busy or dark the art gets. THEME_PALETTES gives the
// procedural layer its matching color identity, and is also the fallback
// look for the brief moment before an arena's image has loaded.

export const TOTAL_LEVELS = 30;

export const ARENAS = [
  { id: "greece", name: "Ruins of Olympus", theme: "Greece", bg: "art/arenas/greece.jpg" },
  { id: "china", name: "Imperial Palace", theme: "China", bg: "art/arenas/china.jpg" },
  { id: "japan", name: "Autumn Shrine", theme: "Japan", bg: "art/arenas/japan.jpg" },
];

export const THEME_PALETTES = {
  China: {
    sky: ["#1a0a0d", "#3a1016", "#6e2222"],
    core: "rgba(255,190,120,0.55)",
    pillar: "10,8,16",
    ground: "#210f0f",
    rim: "rgba(255,180,120,0.55)",
    ember: "255,170,90",
  },
  Greece: {
    sky: ["#0a1222", "#17243f", "#3a567e"],
    core: "rgba(210,225,255,0.5)",
    pillar: "16,16,22",
    ground: "#121722",
    rim: "rgba(210,225,255,0.5)",
    ember: "220,230,255",
  },
  Japan: {
    sky: ["#120a1f", "#2a1438", "#6a2f3a"],
    core: "rgba(255,210,140,0.55)",
    pillar: "10,8,16",
    ground: "#1a1420",
    rim: "rgba(255,200,140,0.55)",
    ember: "255,200,120",
  },
};

export function arenaForLevel(level) {
  return ARENAS[(level - 1) % ARENAS.length];
}

export function chapterProgress(level) {
  const idx = (level - 1) % ARENAS.length;
  return { stage: idx + 1, of: ARENAS.length };
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
