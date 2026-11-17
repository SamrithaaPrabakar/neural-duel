import { Fighter, PHYSICS, rectsOverlap } from "./entities.js";
import { QLearner } from "./qlearning.js";
import { discretizeState } from "./state.js";
import { Particles } from "./particles.js";
import { drawFighterSprite, updateSpriteAnim } from "./sprites.js";
import {
  WEAPONS, SHIELDS, STAT_POOL, STAT_MIN, STAT_MAX,
  defaultStats, statsPointsUsed, deriveCombatProfile, randomLoadout,
} from "./loadout.js";
import { sfx, setMuted, isMuted } from "./audio.js";
import { loadSave, writeSave, clearSave, emptyLifetime, emptyProgress } from "./persistence.js";
import {
  TOTAL_LEVELS, arenaForLevel, chapterProgress, levelEpsilonClamp, levelCpuBonusPoints, loadArenaImage,
} from "./arenas.js";

const ACTIONS = ["moveLeft", "moveRight", "jump", "attack", "heavy", "block", "dash", "special", "idle"];
const DECISION_INTERVAL = 220;
const ROUNDS_TO_WIN = 3;

const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d");

const particles = new Particles();
const learner = new QLearner(ACTIONS);

const savedGame = loadSave();
let lifetime = savedGame ? savedGame.lifetime : emptyLifetime();
let progress = savedGame ? savedGame.progress : emptyProgress();
if (savedGame && savedGame.qlearner) learner.importState(savedGame.qlearner);

function persistProgress() {
  writeSave({ qlearner: learner.exportState(), lifetime, progress });
}

let player = null;
let cpu = null;
let playerLoadout = { weapon: "blade", shield: "buckler", stats: defaultStats() };

// Campaign level currently selected on the level-select screen — defaults to
// the next unplayed level, but the player can revisit any already-unlocked one.
let selectedLevel = progress.highestUnlockedLevel;
let currentArena = arenaForLevel(selectedLevel);

let wins = { player: 0, cpu: 0 };
let roundOver = false;
let roundOverTimer = 0;
let roundOverText = "";
let matchOver = false;
let shake = 0;
let hitStop = 0; // brief freeze-frame on big hits

let ai = { timer: 0, prevState: null, prevAction: null, dealt: 0, took: 0 };
let rewardHistory = [];
let roundRewardSum = 0;
let totalReward = 0;
let roundOutcomes = [];

// ============ SCREEN MANAGEMENT ============
let currentScreen = "screen-menu";
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
  currentScreen = id;
}

function clickSound() { sfx.unlock(); sfx.menuClick(); }

document.getElementById("btn-start").onclick = () => { clickSound(); openLevelSelect(); };
document.getElementById("btn-about").onclick = () => { clickSound(); showScreen("screen-about"); };
document.getElementById("btn-menu").onclick = () => { clickSound(); showScreen("screen-menu"); };
document.querySelectorAll("[data-back]").forEach((b) => {
  b.onclick = () => { clickSound(); showScreen(b.dataset.back); };
});

function syncSoundLabel() {
  const label = `SND: ${isMuted() ? "OFF" : "ON"}`;
  document.getElementById("btn-sound-toggle").textContent = label;
  const settingsBtn = document.getElementById("btn-settings-sound");
  if (settingsBtn) settingsBtn.textContent = `SOUND: ${isMuted() ? "OFF" : "ON"}`;
}
function toggleSound() {
  sfx.unlock();
  setMuted(!isMuted());
  syncSoundLabel();
}
document.getElementById("btn-sound-toggle").onclick = toggleSound;

document.getElementById("btn-settings").onclick = () => {
  clickSound();
  renderSettingsScreen();
  showScreen("screen-settings");
};
document.getElementById("btn-settings-sound").onclick = () => { clickSound(); toggleSound(); };
document.getElementById("btn-settings-clear").onclick = () => {
  clickSound();
  if (!confirm("Clear all saved progress? This resets the AI's learning and your lifetime win/loss record. This can't be undone.")) return;
  learner.reset();
  lifetime = emptyLifetime();
  progress = emptyProgress();
  selectedLevel = 1;
  rewardHistory = [];
  totalReward = 0;
  clearSave();
  renderSettingsScreen();
};

function renderSettingsScreen() {
  syncSoundLabel();
  document.getElementById("settings-lifetime").textContent =
    `${lifetime.wins}W-${lifetime.losses}L (best streak ${lifetime.bestStreak})`;
  document.getElementById("settings-matches").textContent = lifetime.matches;
  document.getElementById("settings-history").textContent = lifetime.history.join(" ") || "–";
  document.getElementById("settings-campaign").textContent = `Level ${progress.highestUnlockedLevel} / ${TOTAL_LEVELS} unlocked`;
}

// ============ LEVEL SELECT ============
function openLevelSelect() {
  renderLevelSelect();
  showScreen("screen-levels");
}

function renderLevelSelect() {
  document.getElementById("level-progress").textContent =
    `${progress.highestUnlockedLevel - 1} / ${TOTAL_LEVELS} CLEARED`;

  const wrap = document.getElementById("level-cards");
  wrap.innerHTML = Array.from({ length: TOTAL_LEVELS }, (_, i) => i + 1).map((lvl) => {
    const arena = arenaForLevel(lvl);
    const unlocked = lvl <= progress.highestUnlockedLevel;
    const cp = chapterProgress(lvl);
    return `
      <button class="level-card ${unlocked ? "" : "locked"} ${lvl === selectedLevel ? "selected" : ""}"
        data-level="${lvl}" ${unlocked ? "" : "disabled"}
        style="background-image:${unlocked ? `url('${arena.bg}')` : "none"}">
        <div class="level-card-shade"></div>
        ${unlocked
          ? `<div class="level-card-num">${lvl}</div><div class="level-card-theme">${arena.theme} · ${cp.stage}/${cp.of}</div>`
          : `<div class="level-card-lock">&#128274;</div>`}
      </button>
    `;
  }).join("");
  wrap.querySelectorAll("[data-level]:not(.locked)").forEach((b) => {
    b.onclick = () => { clickSound(); selectedLevel = parseInt(b.dataset.level, 10); renderLevelSelect(); };
  });

  const arena = arenaForLevel(selectedLevel);
  document.getElementById("level-select-detail").textContent =
    `LEVEL ${selectedLevel} — ${arena.name.toUpperCase()} (${arena.theme})`;
}

document.getElementById("btn-level-continue").onclick = () => { clickSound(); openLoadout(); };

// ============ LOADOUT SCREEN ============
function openLoadout() {
  renderLoadoutScreen();
  showScreen("screen-loadout");
}

function renderLoadoutScreen() {
  const weaponWrap = document.getElementById("weapon-cards");
  weaponWrap.innerHTML = Object.values(WEAPONS).map((w) => `
    <button class="pick-card ${playerLoadout.weapon === w.id ? "selected" : ""}" data-weapon="${w.id}" style="--accent:${w.color}">
      <div class="pick-name">${w.name}</div>
      <div class="pick-desc">${w.desc}</div>
      <div class="pick-stats">Range ${w.range} · Light ${w.lightDamage} · Heavy ${w.heavyDamage}</div>
    </button>
  `).join("");
  weaponWrap.querySelectorAll("[data-weapon]").forEach((b) => {
    b.onclick = () => { clickSound(); playerLoadout.weapon = b.dataset.weapon; renderLoadoutScreen(); };
  });

  const shieldWrap = document.getElementById("shield-cards");
  shieldWrap.innerHTML = Object.values(SHIELDS).map((s) => `
    <button class="pick-card ${playerLoadout.shield === s.id ? "selected" : ""}" data-shield="${s.id}" style="--accent:${s.color}">
      <div class="pick-name">${s.name}</div>
      <div class="pick-desc">${s.desc}</div>
    </button>
  `).join("");
  shieldWrap.querySelectorAll("[data-shield]").forEach((b) => {
    b.onclick = () => { clickSound(); playerLoadout.shield = b.dataset.shield; renderLoadoutScreen(); };
  });

  const used = statsPointsUsed(playerLoadout.stats);
  const left = STAT_POOL - used;
  document.getElementById("points-left").textContent = left;

  const statMeta = {
    power: { label: "POWER", hint: "damage dealt" },
    speed: { label: "SPEED", hint: "move & dash speed" },
    vitality: { label: "VITALITY", hint: "max HP" },
  };
  const rows = document.getElementById("stat-rows");
  rows.innerHTML = Object.entries(statMeta).map(([key, meta]) => {
    const v = playerLoadout.stats[key];
    const pips = Array.from({ length: STAT_MAX }, (_, i) => `<span class="pip ${i < v ? "filled" : ""}"></span>`).join("");
    return `
      <div class="stat-alloc-row">
        <span class="stat-alloc-label">${meta.label}<small>${meta.hint}</small></span>
        <button class="pip-btn" data-stat="${key}" data-dir="-1">–</button>
        <span class="pips">${pips}</span>
        <button class="pip-btn" data-stat="${key}" data-dir="1">+</button>
      </div>
    `;
  }).join("");
  rows.querySelectorAll("[data-stat]").forEach((b) => {
    b.onclick = () => {
      const key = b.dataset.stat;
      const dir = parseInt(b.dataset.dir, 10);
      const cur = playerLoadout.stats[key];
      const nextVal = cur + dir;
      if (nextVal < STAT_MIN || nextVal > STAT_MAX) return;
      if (dir > 0 && statsPointsUsed(playerLoadout.stats) >= STAT_POOL) return;
      clickSound();
      playerLoadout.stats[key] = nextVal;
      renderLoadoutScreen();
    };
  });

  const arena = arenaForLevel(selectedLevel);
  document.getElementById("loadout-level-label").textContent =
    `LEVEL ${selectedLevel} — ${arena.name.toUpperCase()}`;
}

document.getElementById("btn-fight").onclick = () => {
  sfx.unlock();
  sfx.menuConfirm();
  startMatch();
};

// ============ ONBOARDING TOUR ============
const TOUR_STEPS = [
  { title: "THIS IS YOU", text: "The blue fighter. Move with ← / →, jump with ↑, and press Space to attack. Your facing locks onto the opponent automatically." },
  { title: "HEAVIER HITS", text: "Space throws a quick light attack. Press K for a heavy attack — slower and telegraphed, but hits much harder." },
  { title: "BLOCK, PARRY, DASH", text: "Hold Shift to block. Block right at the start of a hit (if your shield allows it) to PARRY — zero damage and the attacker is stunned. Ctrl dashes, a short burst of speed with brief invulnerability." },
  { title: "THE METER", text: "Landing and taking hits fills your SPECIAL meter. At 100% press E to unleash a huge, hard-to-miss special move." },
  { title: "THIS IS YOUR OPPONENT", text: "The red fighter runs on tabular Q-learning, not a script. It equips a random loadout each match and has to learn, from your actual fights, what beats you." },
  { title: "WATCH IT LEARN", text: "Early on it acts mostly at random and looks glitchy and unstable. As its Q-table improves, the glitch clears and its choices get sharper." },
];
let tourIndex = 0;

function tourMockFighter(x, facing) {
  return {
    x, y: PHYSICS.GROUND_Y, facing, state: "idle", flashTimer: 0, invulnerable: false,
    profile: {
      shieldColor: "#9ad1ff",
      weapon: { id: "blade", color: "#ffd23f" },
      shield: { id: "buckler" },
    },
  };
}

function renderTour() {
  const tctx = document.getElementById("tour-canvas").getContext("2d");
  const grd = tctx.createLinearGradient(0, 0, 0, 480);
  grd.addColorStop(0, "#bfe7ff");
  grd.addColorStop(1, "#ffe9c7");
  tctx.fillStyle = grd;
  tctx.fillRect(0, 0, 900, 480);
  tctx.fillStyle = "#9bd97a";
  tctx.fillRect(0, PHYSICS.GROUND_Y + 2, 900, 480 - PHYSICS.GROUND_Y - 2);
  tctx.strokeStyle = "#2b2d3a";
  tctx.lineWidth = 2;
  tctx.beginPath();
  tctx.moveTo(0, PHYSICS.GROUND_Y + 2);
  tctx.lineTo(900, PHYSICS.GROUND_Y + 2);
  tctx.stroke();
  tctx.lineWidth = 1;

  const p = tourMockFighter(260, 1);
  const c = tourMockFighter(640, -1);
  drawFighterSprite(tctx, p, { isCpu: false });
  const glitch = tourIndex === 5 ? 0.55 : 0;
  drawFighterSprite(tctx, c, { isCpu: true, glitchIntensity: glitch });

  const step = TOUR_STEPS[tourIndex];
  document.getElementById("tour-title").textContent = step.title;
  document.getElementById("tour-count").textContent = `${tourIndex + 1}/${TOUR_STEPS.length}`;
  document.getElementById("tour-text").textContent = step.text;
  document.getElementById("tour-back").disabled = tourIndex === 0;
  document.getElementById("tour-next").textContent = tourIndex === TOUR_STEPS.length - 1 ? "CHOOSE LOADOUT" : "NEXT";
}

document.getElementById("btn-tour").onclick = () => {
  clickSound();
  tourIndex = 0;
  showScreen("screen-tour");
  renderTour();
};
document.getElementById("tour-back").onclick = () => {
  clickSound();
  if (tourIndex > 0) { tourIndex--; renderTour(); }
};
document.getElementById("tour-next").onclick = () => {
  clickSound();
  if (tourIndex < TOUR_STEPS.length - 1) { tourIndex++; renderTour(); }
  else openLoadout();
};
document.getElementById("tour-skip").onclick = (e) => {
  e.preventDefault();
  clickSound();
  showScreen("screen-menu");
};

// ============ INPUT ============
// Physical keys map onto named virtual actions, so the keyboard and the
// on-screen touch pad drive the exact same state.
const KEY_MAP = {
  arrowleft: "left", a: "left",
  arrowright: "right", d: "right",
  arrowup: "jump", w: "jump",
  " ": "attack", j: "attack",
  k: "heavy",
  shift: "block",
  control: "dash",
  e: "special",
};
const PREVENT_DEFAULT = new Set(["jump", "attack", "dash", "special"]);

const keysDown = new Set();
const keysPressed = new Set();

window.addEventListener("keydown", (e) => {
  sfx.unlock();
  const raw = e.key.toLowerCase();
  const virtual = KEY_MAP[raw];
  if (virtual) {
    if (PREVENT_DEFAULT.has(virtual) || raw.startsWith("arrow") || raw === " ") e.preventDefault();
    if (!keysDown.has(virtual)) keysPressed.add(virtual);
    keysDown.add(virtual);
  }
  if (raw === "r" && matchOver) fullReset();
});
window.addEventListener("keyup", (e) => {
  const raw = e.key.toLowerCase();
  const virtual = KEY_MAP[raw];
  if (virtual) keysDown.delete(virtual);
});

// on-screen control pad: tap buttons fire a one-frame "press", hold
// buttons set/clear a continuous flag — same virtual-action names as above.
document.querySelectorAll("[data-tap]").forEach((btn) => {
  const name = btn.dataset.tap;
  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    sfx.unlock();
    keysPressed.add(name);
  });
});
document.querySelectorAll("[data-hold]").forEach((btn) => {
  const name = btn.dataset.hold;
  const press = (e) => { e.preventDefault(); sfx.unlock(); keysDown.add(name); btn.classList.add("pressed"); };
  const release = () => { keysDown.delete(name); btn.classList.remove("pressed"); };
  btn.addEventListener("pointerdown", press);
  btn.addEventListener("pointerup", release);
  btn.addEventListener("pointerleave", release);
  btn.addEventListener("pointercancel", release);
});

function playerInput() {
  return {
    left: keysDown.has("left"),
    right: keysDown.has("right"),
    jump: keysPressed.has("jump"),
    attack: keysPressed.has("attack"),
    heavy: keysPressed.has("heavy"),
    block: keysDown.has("block"),
    dash: keysPressed.has("dash"),
    special: keysPressed.has("special"),
  };
}

function actionToInput(action) {
  return {
    left: action === "moveLeft",
    right: action === "moveRight",
    jump: action === "jump",
    attack: action === "attack",
    heavy: action === "heavy",
    block: action === "block",
    dash: action === "dash",
    special: action === "special",
  };
}

function availableActionsFor(fighter) {
  return ACTIONS.filter((a) => {
    if (a === "block" && !fighter.profile.hasBlock) return false;
    if (a === "special" && fighter.meter < 100) return false;
    return true;
  });
}

// ============ MATCH / ROUND FLOW ============
function startMatch() {
  const pProfile = deriveCombatProfile(playerLoadout);
  const bonusPoints = levelCpuBonusPoints(selectedLevel);
  const cLoadout = randomLoadout(Math.random, playerLoadout.weapon, bonusPoints);
  const cProfile = deriveCombatProfile(cLoadout);

  currentArena = arenaForLevel(selectedLevel);
  loadArenaImage(currentArena);

  player = new Fighter(200, 1, "#7fb3d5", pProfile);
  cpu = new Fighter(700, -1, "#d46a6a", cProfile);

  document.getElementById("banner-player").textContent =
    `YOU: ${WEAPONS[playerLoadout.weapon].name} + ${SHIELDS[playerLoadout.shield].name}`;
  document.getElementById("banner-cpu").textContent =
    `CPU: ${WEAPONS[cLoadout.weapon].name} + ${SHIELDS[cLoadout.shield].name} · LV ${selectedLevel}`;

  wins = { player: 0, cpu: 0 };
  roundOutcomes = [];
  roundRewardSum = 0;
  ai.prevState = null;
  ai.prevAction = null;
  ai.timer = 0;
  roundOver = false;
  matchOver = false;

  showScreen("screen-game");
}

function resetRound() {
  player.x = 200; player.y = PHYSICS.GROUND_Y; player.vx = 0; player.vy = 0;
  player.hp = player.maxHp; player.state = "idle"; player.onGround = true; player.invulnerable = false; player.meter = 0;
  cpu.x = 700; cpu.y = PHYSICS.GROUND_Y; cpu.vx = 0; cpu.vy = 0;
  cpu.hp = cpu.maxHp; cpu.state = "idle"; cpu.onGround = true; cpu.invulnerable = false; cpu.meter = 0;
  roundOver = false;
  matchOver = false;
  ai.prevState = null;
  ai.prevAction = null;
  ai.timer = 0;
  roundRewardSum = 0;
}

function fullReset() {
  wins = { player: 0, cpu: 0 };
  roundOutcomes = [];
  resetRound();
}

function endRound(playerWon) {
  roundOver = true;
  roundOverTimer = 1600;
  roundOverText = playerWon ? "YOU WIN THE ROUND" : "CPU WINS THE ROUND";
  if (playerWon) wins.player++; else wins.cpu++;
  roundOutcomes.push(playerWon ? "W" : "L");
  if (roundOutcomes.length > 12) roundOutcomes.shift();

  if (ai.prevState !== null) {
    const terminal = playerWon ? -50 : 50;
    learner.update(ai.prevState, ai.prevAction, terminal, ai.prevState, availableActionsFor(cpu));
    roundRewardSum += terminal;
  }
  rewardHistory.push(roundRewardSum);
  if (rewardHistory.length > 20) rewardHistory.shift();
  learner.decayEpsilon();

  if (playerWon) sfx.roundWin(); else sfx.roundLose();

  if (wins.player >= ROUNDS_TO_WIN || wins.cpu >= ROUNDS_TO_WIN) {
    matchOver = true;
    const playerWonMatch = wins.player >= ROUNDS_TO_WIN;
    roundOverText = playerWonMatch ? "YOU WIN THE MATCH" : "CPU WINS THE MATCH";
    lifetime.matches++;
    if (playerWonMatch) {
      lifetime.wins++;
      lifetime.currentStreak++;
      lifetime.bestStreak = Math.max(lifetime.bestStreak, lifetime.currentStreak);
    } else {
      lifetime.losses++;
      lifetime.currentStreak = 0;
    }
    lifetime.history.push(playerWonMatch ? "W" : "L");
    if (lifetime.history.length > 10) lifetime.history.shift();

    if (playerWonMatch && selectedLevel === progress.highestUnlockedLevel && progress.highestUnlockedLevel < TOTAL_LEVELS) {
      progress.highestUnlockedLevel++;
      roundOverText = `LEVEL ${selectedLevel} CLEARED — NEXT ARENA UNLOCKED`;
    } else if (playerWonMatch && progress.highestUnlockedLevel >= TOTAL_LEVELS && selectedLevel === TOTAL_LEVELS) {
      roundOverText = "CAMPAIGN COMPLETE!";
    }
  }

  persistProgress();
}

function gainMeter(fighter, amount) {
  fighter.meter = Math.min(100, fighter.meter + amount);
}

function checkHits() {
  if (player.isAttackActive() && !player.attackHasHit && rectsOverlap(player.attackHitbox(), cpu.hurtbox())) {
    player.attackHasHit = true;
    const baseDmg = player.currentAttackDamage();
    const result = cpu.applyHit(baseDmg, player.facing);
    if (result.parried) {
      player.parryStun();
      sfx.parry();
      gainMeter(cpu, 15);
      particles.burst(player.x, player.y - PHYSICS.FIGHTER_H / 2, "#ffffff", 16, 6);
    } else {
      ai.took += result.dmg;
      gainMeter(player, result.dmg * 1.4);
      gainMeter(cpu, result.dmg * 0.6);
      const big = player.state === "heavy" || player.state === "special";
      sfx[big ? "hitHeavy" : "hitLight"]();
      if (result.blocked) sfx.block();
      particles.burst(cpu.x, cpu.y - PHYSICS.FIGHTER_H / 2, player.profile.color, big ? 22 : 14, big ? 7 : 5);
      if (big) { shake = 16; hitStop = 60; } else { shake = 8; }
    }
  }
  if (cpu.isAttackActive() && !cpu.attackHasHit && rectsOverlap(cpu.attackHitbox(), player.hurtbox())) {
    cpu.attackHasHit = true;
    const baseDmg = cpu.currentAttackDamage();
    const result = player.applyHit(baseDmg, cpu.facing);
    if (result.parried) {
      cpu.parryStun();
      sfx.parry();
      gainMeter(player, 15);
      particles.burst(cpu.x, cpu.y - PHYSICS.FIGHTER_H / 2, "#ffffff", 16, 6);
    } else {
      ai.dealt += result.dmg;
      gainMeter(cpu, result.dmg * 1.4);
      gainMeter(player, result.dmg * 0.6);
      const big = cpu.state === "heavy" || cpu.state === "special";
      sfx[big ? "hitHeavy" : "hitLight"]();
      if (result.blocked) sfx.block();
      particles.burst(player.x, player.y - PHYSICS.FIGHTER_H / 2, cpu.profile.color, big ? 22 : 14, big ? 7 : 5);
      if (big) { shake = 16; hitStop = 60; } else { shake = 8; }
    }
  }
}

function runAI(dt) {
  ai.timer -= dt;
  if (ai.timer > 0) return;
  ai.timer = DECISION_INTERVAL;

  const currentState = discretizeState(cpu, player, PHYSICS.ARENA_WIDTH);
  const available = availableActionsFor(cpu);

  if (ai.prevState !== null) {
    let reward = -0.03;
    reward += ai.dealt * 1.0;
    reward -= ai.took * 1.0;
    const prevDx = Math.abs(player.x - cpu.x);
    if (ai.prevAction === "moveLeft" || ai.prevAction === "moveRight" || ai.prevAction === "dash") {
      if (prevDx > 160) reward += 0.15;
    }
    learner.update(ai.prevState, ai.prevAction, reward, currentState, available);
    roundRewardSum += reward;
    totalReward += reward;
  }

  ai.dealt = 0;
  ai.took = 0;

  const wasReady = cpu.meter >= 100;
  // The campaign's difficulty curve only clamps how often the CPU explores
  // vs. uses its best-known move for THIS match — it never touches the real,
  // persisted epsilon/Q-table, so early/late levels never fake or hide
  // genuine learning progress.
  const effectiveEpsilon = levelEpsilonClamp(selectedLevel, learner.epsilon);
  const explored = Math.random() < effectiveEpsilon;
  const action = explored
    ? available[Math.floor(Math.random() * available.length)]
    : learner.bestAction(currentState, available).action;
  if (wasReady && action === "special") sfx.meterFull();
  ai.prevState = currentState;
  ai.prevAction = action;
  cpu.pendingAction = action;
}

function cpuInput() {
  return actionToInput(cpu.pendingAction || "idle");
}

function update(dt) {
  if (hitStop > 0) { hitStop -= dt; return; }
  updateSpriteAnim(dt);
  if (matchOver) return;
  if (roundOver) {
    roundOverTimer -= dt;
    if (roundOverTimer <= 0 && !matchOver) resetRound();
    return;
  }

  runAI(dt);

  const pIn = playerInput();
  if (pIn.dash) sfx.dash();
  if (pIn.special && player.meter >= 100) sfx.special();
  player.update(dt, pIn, cpu.x);
  cpu.update(dt, cpuInput(), player.x);
  keysPressed.clear();

  checkHits();
  particles.update(dt);
  shake = Math.max(0, shake - dt * 0.05);

  if (player.hp <= 0 && !roundOver) endRound(false);
  else if (cpu.hp <= 0 && !roundOver) endRound(true);
}

// ============ RENDER ============
const INK = "#2b2d3a";

function roundedRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, h / 2, Math.abs(w) / 2 || r);
  ctx.beginPath();
  if (w >= 0) {
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
  }
  ctx.closePath();
}

// Portrait: a dark glass medallion with a simple bust silhouette inside and
// an accent ring in the fighter's weapon color — same silhouette language
// as the fighters themselves, no extra art needed.
function drawPortrait(cx, cy, r, accent) {
  const bg = ctx.createRadialGradient(cx, cy - r * 0.3, r * 0.1, cx, cy, r);
  bg.addColorStop(0, "#34343c");
  bg.addColorStop(1, "#0a0a0d");
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = bg; ctx.fill();

  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r - 3, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = "#121216";
  ctx.beginPath(); ctx.arc(cx, cy - r * 0.2, r * 0.42, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx, cy + r * 0.85, r * 0.64, r * 0.55, 0, Math.PI, Math.PI * 2); ctx.fill();
  ctx.restore();

  ctx.lineWidth = 3;
  ctx.strokeStyle = accent;
  ctx.beginPath(); ctx.arc(cx, cy, r - 1.5, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 1;
}

function drawHealthBar(x0, x1, y, hp, maxHp, flip) {
  const w = x1 - x0, h = 15, r = h / 2;
  roundedRectPath(ctx, x0, y, w, h, r);
  ctx.fillStyle = "rgba(8,8,10,0.8)";
  ctx.fill();

  const pct = Math.max(0, hp / maxHp);
  const fillW = w * pct;
  if (fillW > 1.5) {
    const fx = flip ? x1 - fillW : x0;
    roundedRectPath(ctx, fx, y, fillW, h, r);
    const grad = ctx.createLinearGradient(fx, 0, fx + fillW, 0);
    if (pct > 0.5) { grad.addColorStop(0, "#ffc24a"); grad.addColorStop(1, "#ff5a3c"); }
    else if (pct > 0.25) { grad.addColorStop(0, "#ff8a3a"); grad.addColorStop(1, "#ef3838"); }
    else { grad.addColorStop(0, "#ff4848"); grad.addColorStop(1, "#b8141e"); }
    ctx.fillStyle = grad;
    ctx.fill();
  }
  roundedRectPath(ctx, x0, y, w, h, r);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.stroke();
  ctx.lineWidth = 1;
}

function drawMeterBar(x0, x1, y, fighter, flip) {
  const w = x1 - x0, h = 7, r = h / 2;
  roundedRectPath(ctx, x0, y, w, h, r);
  ctx.fillStyle = "rgba(8,8,10,0.75)";
  ctx.fill();
  const pct = fighter.meter / 100;
  const fillW = w * pct;
  if (fillW > 1.5) {
    const fx = flip ? x1 - fillW : x0;
    roundedRectPath(ctx, fx, y, fillW, h, r);
    ctx.fillStyle = pct >= 1 ? "#ffd23f" : "#4fc3ff";
    ctx.fill();
  }
  roundedRectPath(ctx, x0, y, w, h, r);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.stroke();
  ctx.lineWidth = 1;
}

function drawDashPips(x, y, fighter, flip) {
  const r = 4.5;
  for (let i = 0; i < fighter.profile.dashCharges; i++) {
    const cx = flip ? x - i * 14 : x + i * 14;
    ctx.beginPath();
    ctx.arc(cx, y, r, 0, Math.PI * 2);
    ctx.fillStyle = i < fighter.dashCharges ? "#7c4dff" : "rgba(255,255,255,0.2)";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.stroke();
    ctx.lineWidth = 1;
  }
}

function drawRoundPips(cx, y, wonCount, flip) {
  const r = 5, gap = 14;
  for (let i = 0; i < ROUNDS_TO_WIN; i++) {
    const px = cx + (flip ? -1 : 1) * (14 + i * gap);
    ctx.beginPath();
    ctx.arc(px, y, r, 0, Math.PI * 2);
    ctx.fillStyle = i < wonCount ? "#ffd23f" : "rgba(255,255,255,0.18)";
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.stroke();
    ctx.lineWidth = 1;
  }
}

// Painted per-arena background art (see arenas.js), cover-fit into the
// canvas with a soft dark gradient over it so the HUD and fighters stay
// legible. Falls back to a procedural moody backdrop for the handful of
// frames before the image has decoded (or if it fails to load).
function drawArenaBackground(ctx) {
  const W = PHYSICS.ARENA_WIDTH, H = PHYSICS.ARENA_HEIGHT;
  const img = currentArena ? loadArenaImage(currentArena) : null;
  if (img && img.complete && img.naturalWidth > 0) {
    const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    const grd = ctx.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, "rgba(10,6,14,0.45)");
    grd.addColorStop(0.35, "rgba(10,6,14,0.05)");
    grd.addColorStop(1, "rgba(10,6,14,0.3)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);
  } else {
    drawProceduralArenaFallback(ctx, performance.now());
  }
}

function drawProceduralArenaFallback(ctx, t) {
  const W = PHYSICS.ARENA_WIDTH, H = PHYSICS.ARENA_HEIGHT, GY = PHYSICS.GROUND_Y;
  const cx = W / 2, coreY = GY - 30;

  const sky = ctx.createLinearGradient(0, 0, 0, GY);
  sky.addColorStop(0, "#120a1f");
  sky.addColorStop(0.55, "#2a1438");
  sky.addColorStop(1, "#6a2f3a");
  ctx.fillStyle = sky;
  ctx.fillRect(-20, -20, W + 40, H + 40);

  // glowing core at the horizon, blended from both fighters' colors
  const core = ctx.createRadialGradient(cx, coreY, 0, cx, coreY, W * 0.55);
  core.addColorStop(0, "rgba(255,210,140,0.55)");
  core.addColorStop(0.3, hexAlpha(player.profile.color, 0.12));
  core.addColorStop(0.6, hexAlpha(cpu.profile.color, 0.08));
  core.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, W, GY);

  // god-rays, slow drift
  ctx.save();
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = "#ffe3b0";
  const rayCount = 9;
  const drift = (t * 0.00006) % (Math.PI * 2);
  for (let i = 0; i < rayCount; i++) {
    const a = drift + (i / rayCount) * Math.PI * 2;
    const spread = 0.055;
    const len = W * 0.9;
    ctx.beginPath();
    ctx.moveTo(cx, coreY);
    ctx.lineTo(cx + Math.cos(a - spread) * len, coreY + Math.sin(a - spread) * len * 0.55);
    ctx.lineTo(cx + Math.cos(a + spread) * len, coreY + Math.sin(a + spread) * len * 0.55);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // parallax pillar silhouettes — three depths, back to front
  const pillarLayers = [
    { y0: GY * 0.25, w: 26, gap: 150, offset: 40, alpha: 0.28, jitter: 0 },
    { y0: GY * 0.42, w: 34, gap: 118, offset: 90, alpha: 0.4, jitter: 10 },
    { y0: GY * 0.6, w: 44, gap: 96, offset: 10, alpha: 0.6, jitter: 18 },
  ];
  for (const layer of pillarLayers) {
    ctx.fillStyle = `rgba(10,8,16,${layer.alpha})`;
    for (let x = -layer.offset; x < W + layer.w; x += layer.gap) {
      const h = GY - layer.y0 + Math.sin(x * 0.01) * layer.jitter;
      ctx.fillRect(x, GY - h, layer.w, h);
    }
  }

  // ground: dark stone, lit by a thin warm rim at the horizon
  ctx.fillStyle = "#1a1420";
  ctx.fillRect(0, GY + 2, W, H - GY - 2);
  const rim = ctx.createLinearGradient(0, GY - 3, 0, GY + 10);
  rim.addColorStop(0, "rgba(0,0,0,0)");
  rim.addColorStop(0.5, "rgba(255,200,140,0.55)");
  rim.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = rim;
  ctx.fillRect(0, GY - 3, W, 13);
  ctx.strokeStyle = "rgba(255,210,150,0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, GY + 2);
  ctx.lineTo(W, GY + 2);
  ctx.stroke();
  ctx.lineWidth = 1;
}

function render() {
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

  drawArenaBackground(ctx);

  drawFighterSprite(ctx, player, { isCpu: false });
  const glitchIntensity = Math.max(0, (learner.epsilon - 0.08)) * 0.9;
  drawFighterSprite(ctx, cpu, { isCpu: true, glitchIntensity });
  particles.draw(ctx);

  const W = PHYSICS.ARENA_WIDTH;
  drawPortrait(50, 50, 28, player.profile.color);
  drawHealthBar(90, 356, 30, player.hp, player.maxHp, false);
  drawMeterBar(90, 356, 49, player, false);
  drawDashPips(90, 62, player, false);
  drawRoundPips(22, 82, wins.player, false);

  drawPortrait(W - 50, 50, 28, cpu.profile.color);
  drawHealthBar(W - 356, W - 90, 30, cpu.hp, cpu.maxHp, true);
  drawMeterBar(W - 356, W - 90, 49, cpu, true);
  drawDashPips(W - 90, 62, cpu, true);
  drawRoundPips(W - 22, 82, wins.cpu, true);

  // center badge: campaign level number in a dark rounded pill
  ctx.font = "bold 15px 'Rajdhani', 'Baloo 2', sans-serif";
  ctx.textAlign = "center";
  const badgeText = `LV ${selectedLevel}`;
  const badgeW = ctx.measureText(badgeText).width + 28;
  roundedRectPath(ctx, W / 2 - badgeW / 2, 22, badgeW, 28, 14);
  ctx.fillStyle = "rgba(8,8,10,0.75)";
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.fillStyle = "#ffd23f";
  ctx.fillText(badgeText, W / 2, 41);

  if (roundOver) {
    ctx.fillStyle = "rgba(8,6,12,0.6)";
    ctx.fillRect(0, 0, W, PHYSICS.ARENA_HEIGHT);
    ctx.fillStyle = "#ffd23f";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 5;
    ctx.font = "800 30px 'Rajdhani', 'Baloo 2', sans-serif";
    ctx.textAlign = "center";
    ctx.strokeText(roundOverText, W / 2, PHYSICS.ARENA_HEIGHT / 2);
    ctx.fillText(roundOverText, W / 2, PHYSICS.ARENA_HEIGHT / 2);
    ctx.lineWidth = 1;
    if (matchOver) {
      ctx.font = "600 16px 'Baloo 2', sans-serif";
      ctx.fillStyle = "#e7e7ef";
      ctx.fillText("Press R for a new match", W / 2, PHYSICS.ARENA_HEIGHT / 2 + 40);
    }
  }
  ctx.restore();
}

function hexAlpha(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function renderHud() {
  const avgRecent = rewardHistory.length
    ? (rewardHistory.reduce((a, b) => a + b, 0) / rewardHistory.length).toFixed(1)
    : "–";
  document.getElementById("stat-epsilon").textContent = learner.epsilon.toFixed(2);
  document.getElementById("stat-tablesize").textContent = learner.tableSize;
  document.getElementById("stat-updates").textContent = learner.updateCount;
  document.getElementById("stat-avgreward").textContent = avgRecent;
  document.getElementById("stat-rounds").textContent = roundOutcomes.join(" ") || "–";
  document.getElementById("stat-lifetime").textContent =
    `${lifetime.wins}W-${lifetime.losses}L (best streak ${lifetime.bestStreak})`;

  const sparkCanvas = document.getElementById("spark");
  const sctx = sparkCanvas.getContext("2d");
  sctx.clearRect(0, 0, sparkCanvas.width, sparkCanvas.height);
  if (rewardHistory.length > 1) {
    const max = Math.max(...rewardHistory.map(Math.abs), 1);
    sctx.strokeStyle = "#39e6a8";
    sctx.lineWidth = 2;
    sctx.beginPath();
    rewardHistory.forEach((r, i) => {
      const x = (i / (rewardHistory.length - 1)) * sparkCanvas.width;
      const y = sparkCanvas.height / 2 - (r / max) * (sparkCanvas.height / 2 - 4);
      if (i === 0) sctx.moveTo(x, y); else sctx.lineTo(x, y);
    });
    sctx.stroke();
    sctx.strokeStyle = "#323650";
    sctx.beginPath();
    sctx.moveTo(0, sparkCanvas.height / 2);
    sctx.lineTo(sparkCanvas.width, sparkCanvas.height / 2);
    sctx.stroke();
  }
}

let lastTime = performance.now();
function loop(now) {
  const dt = Math.min(40, now - lastTime);
  lastTime = now;
  if (currentScreen === "screen-game" && player && cpu) {
    update(dt);
    render();
    renderHud();
  }
  requestAnimationFrame(loop);
}

document.getElementById("btn-reset-brain").onclick = () => {
  clickSound();
  learner.reset();
  rewardHistory = [];
  totalReward = 0;
  persistProgress();
};
document.getElementById("btn-new-match").onclick = () => {
  clickSound();
  selectedLevel = progress.highestUnlockedLevel;
  openLevelSelect();
};

renderLoadoutScreen();
showScreen("screen-menu");
requestAnimationFrame(loop);

window.addEventListener("beforeunload", persistProgress);
window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") persistProgress();
});
