// Fighter rendering: a bigger, more proportioned pixel-art body (drawn as a
// grid of filled squares, then scaled up) plus the weapon and shield drawn
// as separate vector shapes anchored to the hand. Splitting it this way is
// what makes a sword, a spear, and a pair of gauntlets actually read as
// different objects instead of one pixel line — and lets the shield swing
// up to a big, obvious "on guard" position the instant block is held.
//
// The CPU fighter additionally renders a "glitch" overlay whose intensity
// is driven by the Q-learner's epsilon: lots of noise early (it's acting
// randomly), clean and solid once it has mostly stopped exploring.

const PX = 5;
const GRID_W = 16;
const GRID_H = 26;

function emptyGrid() {
  return Array.from({ length: GRID_H }, () => new Array(GRID_W).fill(0));
}

// color-index legend: 1 shirt 2 shirt-light/sleeve 3 skin 4 hair
// 5 pants 6 shoes/belt 10 eyes

function buildBodyGrid(pose, phase) {
  const g = emptyGrid();
  const set = (x, y, v = 1) => { if (y >= 0 && y < GRID_H && x >= 0 && x < GRID_W) g[y][x] = v; };
  const rect = (x0, y0, x1, y1, v = 1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, v);
  };

  // --- hair + head + face (bigger, rounder) ---
  rect(5, 0, 10, 1, 4);
  rect(4, 1, 11, 2, 4);
  rect(5, 2, 10, 8, 3);          // face
  set(6, 2, 0); set(9, 2, 0);    // round the hairline corners
  set(7, 4, 10); set(10, 4, 10); // wait, keep eyes centered below
  set(7, 5, 10); set(10, 5, 10); // eyes
  rect(7, 7, 10, 7, 10);         // mouth line

  // --- neck ---
  rect(7, 9, 10, 10, 3);

  const lean = pose === "walk" ? (phase === 0 ? 1 : 0) : 0;

  // --- torso (shirt with a sleeve-shade band) ---
  rect(4 + lean, 11, 13, 19, 1);
  rect(5 + lean, 12, 12, 14, 2);
  rect(4 + lean, 19, 13, 20, 6); // belt

  // --- upper arm stubs (forearms + weapon/shield drawn separately) ---
  rect(1 + lean, 12, 3 + lean, 18, 3);
  rect(12 + lean, 12, 14 + lean, 18, 3);

  const legSwing = pose === "walk" ? (phase === 0 ? 2 : -2) : 0;

  // --- legs + shoes ---
  rect(5, 21, 8, 23 + legSwing, 5);
  rect(9, 21, 12, 23 - legSwing, 5);
  rect(4, 24 + legSwing, 8, 25, 6);
  rect(9, 24 - legSwing, 13, 25, 6);

  return g;
}

const BASE_PALETTES = {
  player: { 1: "#2f6fa8", 2: "#4a8ec4", 3: "#eab98a", 4: "#2b1c14", 5: "#394150", 6: "#1b1d26", 10: "#12141c" },
  cpu: { 1: "#b03a3a", 2: "#cf5a5a", 3: "#eab98a", 4: "#20130e", 5: "#394150", 6: "#1b1d26", 10: "#12141c" },
  hit: { 1: "#f3f3f6", 2: "#ffffff", 3: "#f3f3f6", 4: "#ffffff", 5: "#f3f3f6", 6: "#e2e2ea", 10: "#12141c" },
};

const bodyFrameCache = new Map();

function renderBodyFrame(pose, phase, palette) {
  const key = `${pose}-${phase}-${palette}`;
  if (bodyFrameCache.has(key)) return bodyFrameCache.get(key);

  const grid = buildBodyGrid(pose, phase);
  const c = document.createElement("canvas");
  c.width = GRID_W * PX;
  c.height = GRID_H * PX;
  const cx = c.getContext("2d");
  const colors = BASE_PALETTES[palette];

  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const v = grid[y][x];
      if (!v) continue;
      cx.fillStyle = colors[v];
      cx.fillRect(x * PX, y * PX, PX, PX);
    }
  }
  bodyFrameCache.set(key, c);
  return c;
}

function poseFor(fighter) {
  if (fighter.state === "attack") return "attack";
  if (fighter.state === "heavy") return "heavy";
  if (fighter.state === "special") return "special";
  if (fighter.state === "block") return "block";
  if (fighter.state === "dash") return "dash";
  if (fighter.state === "walk") return "walk";
  return "idle";
}

export function spriteSize() {
  return { w: GRID_W * PX, h: GRID_H * PX };
}

// Hand anchor points, in grid cells, authored for a right-facing fighter.
// mainHand carries the weapon, offHand carries the shield.
const HAND_RIG = {
  idle: { main: [14, 15], off: [1.5, 14], angle: 1.15, reach: 0.85 },
  walk: { main: [14, 15], off: [1.5, 14], angle: 1.15, reach: 0.85 },
  dash: { main: [14, 14], off: [1.5, 13], angle: 1.0, reach: 0.8 },
  attack: { main: [16, 11], off: [1, 13], angle: 0, reach: 1.15 },
  heavy: { main: [13, 1.5], off: [1, 13], angle: -1.9, reach: 1.25 },
  special: { main: [16, 9], off: [1, 9], angle: 0, reach: 1.3 },
  block: { main: [10.5, 13], off: [7.5, 10], angle: 1.15, reach: 0.5 },
};

function handPoint(cellPair) {
  return { x: cellPair[0] * PX, y: cellPair[1] * PX };
}

function drawWeapon(ctx, hand, angle, scale, weaponId, color) {
  ctx.save();
  ctx.translate(hand.x, hand.y);
  ctx.rotate(angle);

  if (weaponId === "blade") {
    ctx.fillStyle = "#5a4632";
    ctx.fillRect(-3 * scale, 0, 6 * scale, 10 * scale);
    ctx.fillStyle = "#2a2a2a";
    ctx.fillRect(-11 * scale, 9 * scale, 22 * scale, 4 * scale);
    ctx.fillStyle = color;
    ctx.fillRect(-4 * scale, 12 * scale, 8 * scale, 38 * scale);
    ctx.beginPath();
    ctx.moveTo(-4 * scale, 50 * scale);
    ctx.lineTo(4 * scale, 50 * scale);
    ctx.lineTo(0, 60 * scale);
    ctx.closePath();
    ctx.fill();
  } else if (weaponId === "spear") {
    ctx.fillStyle = "#8a6239";
    ctx.fillRect(-2.5 * scale, 0, 5 * scale, 60 * scale);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-7 * scale, 60 * scale);
    ctx.lineTo(7 * scale, 60 * scale);
    ctx.lineTo(0, 80 * scale);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#2a2a2a";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else if (weaponId === "gauntlets") {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 10 * scale, 11 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#2a2a2a";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.beginPath();
    ctx.arc(-3 * scale, 6 * scale, 3 * scale, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawShield(ctx, hand, shieldId, color, isBlocking) {
  if (shieldId === "evasive") {
    // bare off-hand: a clenched fist, ready to dodge rather than block
    ctx.save();
    ctx.translate(hand.x, hand.y);
    ctx.fillStyle = "#eab98a";
    ctx.beginPath();
    ctx.arc(0, 8, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  const scale = isBlocking ? 1.9 : 1;
  ctx.save();
  ctx.translate(hand.x, hand.y);

  if (shieldId === "buckler") {
    const r = 13 * scale;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 8, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#2a2a2a";
    ctx.lineWidth = isBlocking ? 3 : 2;
    ctx.stroke();
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.arc(0, 8, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
  } else if (shieldId === "tower") {
    const w = 20 * scale, h = 40 * scale;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2 + 8);
    ctx.lineTo(w / 2, -h / 2 + 8);
    ctx.lineTo(w / 2, h / 2);
    ctx.lineTo(0, h / 2 + 10);
    ctx.lineTo(-w / 2, h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#2a2a2a";
    ctx.lineWidth = isBlocking ? 3 : 2;
    ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0); ctx.stroke();
  }
  ctx.restore();
}

function drawGlitch(ctx, x, y, w, h, intensity) {
  if (intensity <= 0) return;
  const bands = Math.floor(intensity * 10);
  for (let i = 0; i < bands; i++) {
    const by = y + Math.random() * h;
    const bh = 2 + Math.random() * 4;
    const bx = x + (Math.random() - 0.5) * 10 * intensity;
    ctx.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,0.4)" : "rgba(255,210,80,0.35)";
    ctx.fillRect(bx, by, w, bh);
  }
}

let walkPhaseTimer = 0;
let walkPhase = 0;

export function updateSpriteAnim(dt) {
  walkPhaseTimer += dt;
  if (walkPhaseTimer > 140) {
    walkPhaseTimer = 0;
    walkPhase = 1 - walkPhase;
  }
}

export function drawFighterSprite(ctx, fighter, { isCpu = false, glitchIntensity = 0 } = {}) {
  const pose = poseFor(fighter);
  const phase = pose === "walk" ? walkPhase : 0;
  const palette = fighter.flashTimer > 0 ? "hit" : (isCpu ? "cpu" : "player");
  const frame = renderBodyFrame(pose, phase, palette);
  const { w, h } = spriteSize();

  const weaponId = fighter.profile ? fighter.profile.weapon.id : "blade";
  const weaponColor = fighter.profile ? fighter.profile.weapon.color : "#ffd23f";
  const shieldId = fighter.profile ? fighter.profile.shield.id : "buckler";
  const shieldColor = fighter.profile ? fighter.profile.shieldColor : "#9ad1ff";
  const isBlocking = fighter.state === "block";
  const rig = HAND_RIG[pose] || HAND_RIG.idle;

  const drawY = fighter.y - h;

  if (fighter.state === "special") {
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = weaponColor;
    ctx.beginPath();
    ctx.arc(fighter.x, fighter.y - h / 2, w * 0.85, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  if (fighter.invulnerable) ctx.globalAlpha = 0.55;

  const flipped = fighter.facing === -1;
  if (flipped) { ctx.translate(fighter.x, 0); ctx.scale(-1, 1); }
  const originX = flipped ? -w / 2 : fighter.x - w / 2;

  ctx.drawImage(frame, originX, drawY, w, h);

  const mainHand = { x: originX + rig.main[0] * PX, y: drawY + rig.main[1] * PX };
  const offHand = { x: originX + rig.off[0] * PX, y: drawY + rig.off[1] * PX };

  if (weaponId === "gauntlets") {
    drawWeapon(ctx, mainHand, 0, rig.reach, "gauntlets", weaponColor);
  } else if (!isBlocking) {
    drawWeapon(ctx, mainHand, rig.angle, rig.reach, weaponId, weaponColor);
  }
  drawShield(ctx, offHand, shieldId, shieldColor, isBlocking);

  ctx.restore();

  if (isCpu && glitchIntensity > 0) {
    drawGlitch(ctx, originX, drawY, w, h, glitchIntensity);
  }
}
