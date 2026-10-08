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

const ACTIONS = ["moveLeft", "moveRight", "jump", "attack", "heavy", "block", "dash", "special", "idle"];
const DECISION_INTERVAL = 220;
const ROUNDS_TO_WIN = 3;

const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d");

const particles = new Particles();
const learner = new QLearner(ACTIONS);

let player = null;
let cpu = null;
let playerLoadout = { weapon: "blade", shield: "buckler", stats: defaultStats() };

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

document.getElementById("btn-start").onclick = () => { clickSound(); openLoadout(); };
document.getElementById("btn-about").onclick = () => { clickSound(); showScreen("screen-about"); };
document.getElementById("btn-menu").onclick = () => { clickSound(); showScreen("screen-menu"); };
document.querySelectorAll("[data-back]").forEach((b) => {
  b.onclick = () => { clickSound(); showScreen(b.dataset.back); };
});

document.getElementById("btn-sound-toggle").onclick = () => {
  sfx.unlock();
  const next = !isMuted();
  setMuted(next);
  document.getElementById("btn-sound-toggle").textContent = `SND: ${next ? "OFF" : "ON"}`;
};

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
  const cLoadout = randomLoadout(Math.random, playerLoadout.weapon);
  const cProfile = deriveCombatProfile(cLoadout);

  player = new Fighter(200, 1, "#7fb3d5", pProfile);
  cpu = new Fighter(700, -1, "#d46a6a", cProfile);

  document.getElementById("banner-player").textContent =
    `YOU: ${WEAPONS[playerLoadout.weapon].name} + ${SHIELDS[playerLoadout.shield].name}`;
  document.getElementById("banner-cpu").textContent =
    `CPU: ${WEAPONS[cLoadout.weapon].name} + ${SHIELDS[cLoadout.shield].name}`;

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
    roundOverText = wins.player >= ROUNDS_TO_WIN ? "YOU WIN THE MATCH" : "CPU WINS THE MATCH";
  }
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
  const { action } = learner.chooseAction(currentState, available);
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

function drawHealthBar(x, hp, maxHp, flip) {
  const w = 300, h = 18, seg = 10;
  ctx.fillStyle = "#e7e9f0";
  ctx.fillRect(x, 20, w, h);
  const pct = Math.max(0, hp / maxHp);
  ctx.fillStyle = pct > 0.3 ? "#2ecc8f" : "#ff4fa0";
  if (flip) ctx.fillRect(x + w * (1 - pct), 20, w * pct, h);
  else ctx.fillRect(x, 20, w * pct, h);
  ctx.strokeStyle = "#ffffff";
  for (let i = 1; i < seg; i++) {
    const sx = x + (w / seg) * i;
    ctx.beginPath(); ctx.moveTo(sx, 20); ctx.lineTo(sx, 20 + h); ctx.stroke();
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = INK;
  ctx.strokeRect(x, 20, w, h);
  ctx.lineWidth = 1;
}

function drawMeterBar(x, fighter, flip) {
  const w = 300, h = 9;
  const y = 42;
  ctx.fillStyle = "#e7e9f0";
  ctx.fillRect(x, y, w, h);
  const pct = fighter.meter / 100;
  ctx.fillStyle = pct >= 1 ? "#ffd23f" : "#4fc3ff";
  if (flip) ctx.fillRect(x + w * (1 - pct), y, w * pct, h);
  else ctx.fillRect(x, y, w * pct, h);
  ctx.lineWidth = 2;
  ctx.strokeStyle = INK;
  ctx.strokeRect(x, y, w, h);
  ctx.lineWidth = 1;
}

function drawDashPips(x, fighter, flip) {
  const r = 6;
  for (let i = 0; i < fighter.profile.dashCharges; i++) {
    const cx = flip ? x - i * 18 : x + i * 18;
    ctx.beginPath();
    ctx.arc(cx, 63, r, 0, Math.PI * 2);
    ctx.fillStyle = i < fighter.dashCharges ? "#7c4dff" : "#d8dae3";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.lineWidth = 1;
  }
}

function render() {
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

  // bright backdrop: sky-to-sun gradient tinted by each fighter's weapon color
  const grd = ctx.createLinearGradient(0, 0, 0, PHYSICS.ARENA_HEIGHT);
  grd.addColorStop(0, "#bfe7ff");
  grd.addColorStop(1, "#ffe9c7");
  ctx.fillStyle = grd;
  ctx.fillRect(-20, -20, canvas.width + 40, canvas.height + 40);

  const sideGlow = ctx.createLinearGradient(0, 0, PHYSICS.ARENA_WIDTH, 0);
  sideGlow.addColorStop(0, hexAlpha(player.profile.color, 0.16));
  sideGlow.addColorStop(0.5, "rgba(255,255,255,0)");
  sideGlow.addColorStop(1, hexAlpha(cpu.profile.color, 0.16));
  ctx.fillStyle = sideGlow;
  ctx.fillRect(0, 0, PHYSICS.ARENA_WIDTH, PHYSICS.ARENA_HEIGHT);

  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  for (let gx = 0; gx <= PHYSICS.ARENA_WIDTH; gx += 60) {
    ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, PHYSICS.GROUND_Y); ctx.stroke();
  }
  ctx.fillStyle = "#9bd97a";
  ctx.fillRect(0, PHYSICS.GROUND_Y + 2, PHYSICS.ARENA_WIDTH, PHYSICS.ARENA_HEIGHT - PHYSICS.GROUND_Y - 2);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, PHYSICS.GROUND_Y + 2);
  ctx.lineTo(PHYSICS.ARENA_WIDTH, PHYSICS.GROUND_Y + 2);
  ctx.stroke();
  ctx.lineWidth = 1;

  drawFighterSprite(ctx, player, { isCpu: false });
  const glitchIntensity = Math.max(0, (learner.epsilon - 0.08)) * 0.9;
  drawFighterSprite(ctx, cpu, { isCpu: true, glitchIntensity });
  particles.draw(ctx);

  drawHealthBar(20, player.hp, player.maxHp, false);
  drawMeterBar(20, player, false);
  drawDashPips(20, player, false);

  drawHealthBar(PHYSICS.ARENA_WIDTH - 320, cpu.hp, cpu.maxHp, true);
  drawMeterBar(PHYSICS.ARENA_WIDTH - 320, cpu, true);
  drawDashPips(PHYSICS.ARENA_WIDTH - 20, cpu, true);

  ctx.fillStyle = "#fff";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.font = "bold 18px 'Press Start 2P', monospace";
  ctx.textAlign = "center";
  ctx.strokeText(`${wins.player} - ${wins.cpu}`, PHYSICS.ARENA_WIDTH / 2, 36);
  ctx.fillText(`${wins.player} - ${wins.cpu}`, PHYSICS.ARENA_WIDTH / 2, 36);
  ctx.lineWidth = 1;

  if (roundOver) {
    ctx.fillStyle = "rgba(43,45,58,0.55)";
    ctx.fillRect(0, 0, PHYSICS.ARENA_WIDTH, PHYSICS.ARENA_HEIGHT);
    ctx.fillStyle = "#ffd23f";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.font = "bold 28px 'Press Start 2P', monospace";
    ctx.strokeText(roundOverText, PHYSICS.ARENA_WIDTH / 2, PHYSICS.ARENA_HEIGHT / 2);
    ctx.fillText(roundOverText, PHYSICS.ARENA_WIDTH / 2, PHYSICS.ARENA_HEIGHT / 2);
    ctx.lineWidth = 1;
    if (matchOver) {
      ctx.font = "16px 'Baloo 2', sans-serif";
      ctx.fillStyle = "#e7e7ef";
      ctx.fillText("Press R for a new match", PHYSICS.ARENA_WIDTH / 2, PHYSICS.ARENA_HEIGHT / 2 + 40);
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
};
document.getElementById("btn-new-match").onclick = () => { clickSound(); openLoadout(); };

renderLoadoutScreen();
showScreen("screen-menu");
requestAnimationFrame(loop);
