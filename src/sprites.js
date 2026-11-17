// Fighter rendering: an articulated silhouette rig — torso, head, and four
// limb segments (upper arm/forearm, thigh/shin) built from filled, curved
// shapes driven by a small per-pose angle table, rather than a fixed
// pixel-grid bitmap. That's what lets a heavy attack read as an actual
// flying kick instead of a palette-swapped idle pose.
//
// The whole body is built on an OFFSCREEN canvas, always facing right, at a
// fixed local origin — then blitted onto the real canvas scaled up and
// mirrored for facing. Building it offscreen first is what makes the rim
// light possible: the dilated-silhouette trick below draws the whole body's
// alpha shape eight times, offset by a pixel in every direction, in a light
// color underneath the black body — so there's one continuous light edge
// around the OUTSIDE of the whole figure, not a separate outline around
// every individual limb (which is what was reading as assembled parts
// rather than a person). It also guarantees the fighter stays visible even
// against a very dark patch of background.

const SILHOUETTE = "#06060a";
const FLASH_WHITE = "#ffffff";
const RIM_LIGHT = "rgba(255, 238, 200, 0.95)";

const HEAD_R = 9;
const NECK = 4;
const TORSO_LEN = 35;
const SHOULDER_X = 11;
const HIP_X = 6.5;
const UPPER_ARM = 21;
const FOREARM = 19;
const THIGH = 27;
const SHIN = 25;

// Every joint width is shared by the two segments that meet there, so a cap
// circle of that same radius always blends them with zero seam regardless
// of bend angle.
const SHOULDER_W = 13;
const ELBOW_W = 9;
const WRIST_W = 6;
const HIP_W = 18;
const KNEE_W = 13;
const ANKLE_W = 8.5;
const NECK_W = 10;

const UPPER_ARM_W = [SHOULDER_W, ELBOW_W];
const FOREARM_W = [ELBOW_W, WRIST_W];
const THIGH_W = [HIP_W, KNEE_W];
const SHIN_W = [KNEE_W, ANKLE_W];
const TORSO_W = [HIP_W, NECK_W + 20]; // hip -> shoulder

// Local offscreen canvas the body is always built on, right-facing, before
// being scaled up and mirrored onto the real canvas.
const RENDER_SCALE = 1.7;
const OFF_W = 150;
const OFF_H = 170;
const ORIGIN_X = OFF_W / 2;
const ORIGIN_Y = OFF_H - 20; // 20px of slack below the feet

// Angles are radians from straight-down, rotating toward +x (the facing
// direction) for positive values. F = front limb (weapon side), B = back
// limb (shield side). Authored for a right-facing fighter; the caller
// mirrors the whole drawing for facing === -1.
const POSES = {
  idle:    { lean: 0,     shF: 0.12,  elF: 0.35, shB: 0.12,  elB: 0.35, hipF: -0.06, kneeF: 0.12, hipB: 0.10,  kneeB: 0.12 },
  walkA:   { lean: 0.03,  shF: 0.05,  elF: 0.30, shB: 0.25,  elB: 0.40, hipF: -0.36, kneeF: 0.50, hipB: 0.36,  kneeB: 0.15 },
  walkB:   { lean: 0.03,  shF: 0.25,  elF: 0.40, shB: 0.05,  elB: 0.30, hipF: 0.36,  kneeF: 0.15, hipB: -0.36, kneeB: 0.50 },
  attack:  { lean: 0.24,  shF: -0.95, elF: -0.10, shB: 0.35, elB: 0.55, hipF: -0.18, kneeF: 0.20, hipB: 0.18,  kneeB: 0.25 },
  heavy:   { lean: -0.38, shF: 0.40,  elF: 0.30, shB: -0.32, elB: 0.40, hipF: -1.15, kneeF: 0.20, hipB: 0.38,  kneeB: 1.05 },
  special: { lean: -0.12, shF: -1.05, elF: -0.30, shB: -0.30, elB: -0.20, hipF: -0.28, kneeF: 0.22, hipB: 0.28, kneeB: 0.22 },
  block:   { lean: 0.08,  shF: -0.65, elF: -0.75, shB: -0.55, elB: -0.65, hipF: -0.15, kneeF: 0.30, hipB: 0.15, kneeB: 0.30 },
  dash:    { lean: 0.42,  shF: 0.55,  elF: 0.30, shB: 0.65,  elB: 0.40, hipF: -0.44, kneeF: 0.12, hipB: 0.58,  kneeB: 0.65 },
  hitstun: { lean: -0.34, shF: 0.60,  elF: 0.50, shB: -0.50, elB: 0.30, hipF: 0.32,  kneeF: 0.40, hipB: -0.18, kneeB: 0.50 },
  jump:    { lean: 0,     shF: -0.15, elF: 0.30, shB: -0.10, elB: 0.30, hipF: -0.50, kneeF: 0.90, hipB: 0.30,  kneeB: 0.90 },
};

function poseFor(fighter) {
  if (fighter.state === "attack") return "attack";
  if (fighter.state === "heavy") return "heavy";
  if (fighter.state === "special") return "special";
  if (fighter.state === "block") return "block";
  if (fighter.state === "dash") return "dash";
  if (fighter.state === "hitstun") return "hitstun";
  if (fighter.state === "jump") return "jump";
  if (fighter.state === "walk") return "walk";
  return "idle";
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

function pointAt(x0, y0, angle, length) {
  return { x: x0 + Math.sin(angle) * length, y: y0 + Math.cos(angle) * length };
}

// A filled wedge from p0 (width w0) to p1 (width w1) whose two long edges
// bulge gently outward at the midpoint instead of running straight — a
// straight-edged taper reads as a pipe or cone; a bulging one reads as a
// muscle. `bulge` is that extra bow as a fraction of the segment's own
// half-width.
function limb(ctx, p0, p1, w0, w1, bulge = 0.3) {
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const h0 = w0 / 2, h1 = w1 / 2;
  const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
  const straightMid = (h0 + h1) / 2;
  const cOut = straightMid + straightMid * bulge * 2;
  ctx.beginPath();
  ctx.moveTo(p0.x + nx * h0, p0.y + ny * h0);
  ctx.quadraticCurveTo(mx + nx * cOut, my + ny * cOut, p1.x + nx * h1, p1.y + ny * h1);
  ctx.lineTo(p1.x - nx * h1, p1.y - ny * h1);
  ctx.quadraticCurveTo(mx - nx * cOut, my - ny * cOut, p0.x - nx * h0, p0.y - ny * h0);
  ctx.closePath();
  ctx.fill();
}

// A round cap at a joint so two segments blend into one continuous
// silhouette instead of showing a notch at the bend. Radius is sized a
// touch over the shared joint width for a confident overlap.
function cap(ctx, p, w) {
  ctx.beginPath();
  ctx.arc(p.x, p.y, (w / 2) * 1.05, 0, Math.PI * 2);
  ctx.fill();
}

// A small flattened foot blob, offset forward (+local x) from the ankle so
// it reads as a foot planted on the ground rather than the shin just
// stopping mid-air.
function footShape(ctx, ankle, size) {
  ctx.beginPath();
  ctx.ellipse(ankle.x + size * 0.6, ankle.y + size * 0.12, size * 0.95, size * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
}

// shoulder/hip -> elbow/knee -> hand/foot, as one continuous blended limb
function limbChain(ctx, p0, p1, p2, w, bulge) {
  cap(ctx, p0, w[0][0]);
  limb(ctx, p0, p1, w[0][0], w[0][1], bulge);
  cap(ctx, p1, w[0][1]);
  limb(ctx, p1, p2, w[1][0], w[1][1], bulge);
  cap(ctx, p2, w[1][1]);
}

function drawWeapon(ctx, hand, armAngle, weaponId, fillColor) {
  ctx.save();
  ctx.translate(hand.x, hand.y);
  ctx.rotate(armAngle);
  ctx.fillStyle = fillColor;

  if (weaponId === "blade") {
    ctx.beginPath();
    ctx.moveTo(-2.5, 6);
    ctx.lineTo(2.5, 6);
    ctx.lineTo(1.8, 46);
    ctx.lineTo(0, 52);
    ctx.lineTo(-1.8, 46);
    ctx.closePath();
    ctx.fill();
  } else if (weaponId === "spear") {
    ctx.beginPath();
    ctx.moveTo(-1.8, 0);
    ctx.lineTo(1.8, 0);
    ctx.lineTo(1.8, 58);
    ctx.lineTo(0, 70);
    ctx.lineTo(-1.8, 58);
    ctx.closePath();
    ctx.fill();
  } else if (weaponId === "gauntlets") {
    ctx.beginPath();
    ctx.arc(0, 4, 7.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawShield(ctx, hand, armAngle, shieldId, isBlocking, fillColor) {
  if (shieldId === "evasive") return; // bare off-hand — nothing extra to draw

  const scale = isBlocking ? 1.6 : 0.85;
  ctx.save();
  ctx.translate(hand.x, hand.y);
  ctx.rotate(armAngle * 0.3);
  ctx.fillStyle = fillColor;

  if (shieldId === "buckler") {
    const r = 11 * scale;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
  } else if (shieldId === "tower") {
    const w = 17 * scale, h = 34 * scale;
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2);
    ctx.lineTo(w / 2, -h / 2);
    ctx.lineTo(w / 2, h / 2 - 7);
    ctx.lineTo(0, h / 2);
    ctx.lineTo(-w / 2, h / 2 - 7);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawGlitch(ctx, cx, topY, bottomY, intensity) {
  if (intensity <= 0) return;
  const w = 90;
  const h = bottomY - topY;
  const bands = Math.floor(intensity * 10);
  for (let i = 0; i < bands; i++) {
    const by = topY + Math.random() * h;
    const bh = 2 + Math.random() * 5;
    const bx = cx - w / 2 + (Math.random() - 0.5) * 14 * intensity;
    ctx.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,0.4)" : "rgba(190,190,200,0.35)";
    ctx.fillRect(bx, by, w, bh);
  }
}

export function spriteSize() {
  return { w: OFF_W * RENDER_SCALE, h: OFF_H * RENDER_SCALE };
}

// Builds the whole right-facing body (no weapon/shield) at the fixed local
// origin on the given offscreen context, filled with `color`. Returns the
// key joint points (in local coords) so the caller can anchor the weapon,
// shield and head without recomputing the pose math.
function buildBody(octx, pose, poseKey, color) {
  octx.fillStyle = color;

  const heavyLift = poseKey === "heavy" ? -16 : 0;
  const hipY = ORIGIN_Y - (THIGH + SHIN) - 4 + heavyLift;
  const shoulderY = hipY - TORSO_LEN;
  const headCenterY = shoulderY - NECK - HEAD_R;
  const torsoLeanX = Math.sin(pose.lean) * TORSO_LEN * 0.4;
  const cx = ORIGIN_X;

  const hipB = { x: cx - HIP_X + torsoLeanX * 0.3, y: hipY };
  const kneeB = pointAt(hipB.x, hipB.y, pose.hipB, THIGH);
  const footB = pointAt(kneeB.x, kneeB.y, pose.hipB + pose.kneeB, SHIN);
  limbChain(octx, hipB, kneeB, footB, [THIGH_W, SHIN_W], 0.28);
  footShape(octx, footB, ANKLE_W);

  const hipF = { x: cx + HIP_X + torsoLeanX * 0.3, y: hipY };
  const kneeF = pointAt(hipF.x, hipF.y, pose.hipF, THIGH);
  const footF = pointAt(kneeF.x, kneeF.y, pose.hipF + pose.kneeF, SHIN);
  limbChain(octx, hipF, kneeF, footF, [THIGH_W, SHIN_W], 0.28);
  footShape(octx, footF, ANKLE_W);

  const hipCenter = { x: cx + torsoLeanX * 0.3, y: hipY };
  const shoulderCenter = { x: cx + torsoLeanX, y: shoulderY };
  limb(octx, hipCenter, shoulderCenter, TORSO_W[0], TORSO_W[1], 0.08);

  const shB = { x: shoulderCenter.x - SHOULDER_X, y: shoulderCenter.y };
  const elB = pointAt(shB.x, shB.y, pose.shB, UPPER_ARM);
  const handB = pointAt(elB.x, elB.y, pose.shB + pose.elB, FOREARM);
  limbChain(octx, shB, elB, handB, [UPPER_ARM_W, FOREARM_W], 0.3);
  cap(octx, handB, WRIST_W + 2);

  const headCenter = { x: shoulderCenter.x, y: headCenterY };
  const neckBase = { x: shoulderCenter.x, y: headCenter.y + HEAD_R * 0.85 };
  limb(octx, shoulderCenter, neckBase, NECK_W, NECK_W * 0.8, 0.1);
  cap(octx, neckBase, NECK_W * 0.8);
  octx.beginPath();
  octx.arc(headCenter.x, headCenter.y, HEAD_R, 0, Math.PI * 2);
  octx.fill();

  const shF = { x: shoulderCenter.x + SHOULDER_X, y: shoulderCenter.y };
  const elF = pointAt(shF.x, shF.y, pose.shF, UPPER_ARM);
  const handF = pointAt(elF.x, elF.y, pose.shF + pose.elF, FOREARM);
  limbChain(octx, shF, elF, handF, [UPPER_ARM_W, FOREARM_W], 0.3);
  cap(octx, handF, WRIST_W + 2);

  return { headCenterY, hipY, handF, handB, shF, shB };
}

const offCanvas = document.createElement("canvas");
offCanvas.width = OFF_W;
offCanvas.height = OFF_H;
const offCtx = offCanvas.getContext("2d");

// A second offscreen buffer, isolated from the real canvas, where the rim
// light is composited — so recoloring it with "source-atop" only ever
// touches this buffer's own dilated-silhouette pixels, never whatever is
// already drawn on the main canvas underneath.
const outlineCanvas = document.createElement("canvas");
outlineCanvas.width = OFF_W;
outlineCanvas.height = OFF_H;
const outlineCtx = outlineCanvas.getContext("2d");

// Unit directions for the rim-light dilation; the actual per-pixel offset
// is `dir * magnitude`, where magnitude is chosen per source image so the
// rim stays the same apparent thickness on screen regardless of how much
// that source gets scaled up or down to its destination size.
const OUTLINE_DIRS = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7],
];

// Real illustrated sprites, one per pose that has art so far — flat black
// silhouettes on a white background, alpha-keyed by luminance at build
// time so white becomes transparent (see the processing step that made
// these files; the source webp isn't checked in). Poses with no entry here
// stay on the procedural rig above until matching art exists for them —
// a deliberate, visible seam for now, not a bug.
const POSE_SPRITE_SRC = {
  idle: "art/fighter/idle.png",
  attack: "art/fighter/attack.png",
  heavy: "art/fighter/heavy.png",
  block: "art/fighter/block.png",
};
const poseSprites = {};
for (const [key, src] of Object.entries(POSE_SPRITE_SRC)) {
  const img = new Image();
  img.src = src;
  poseSprites[key] = img;
}

let rimCanvas = null, rimCtx = null;
let flashCanvas = null, flashCtx2 = null;

function getScratchCanvas(which, w, h) {
  if (which === "rim") {
    if (!rimCanvas) { rimCanvas = document.createElement("canvas"); rimCtx = rimCanvas.getContext("2d"); }
    if (rimCanvas.width !== w || rimCanvas.height !== h) { rimCanvas.width = w; rimCanvas.height = h; }
    return [rimCanvas, rimCtx];
  }
  if (!flashCanvas) { flashCanvas = document.createElement("canvas"); flashCtx2 = flashCanvas.getContext("2d"); }
  if (flashCanvas.width !== w || flashCanvas.height !== h) { flashCanvas.width = w; flashCanvas.height = h; }
  return [flashCanvas, flashCtx2];
}

// Draws any black-on-transparent source (an <img> or a <canvas>) at
// destX/destY/destW/destH, with the same rim-light treatment as the
// procedural rig, scaled so the rim reads at a consistent thickness.
function drawSilhouetteSource(ctx, src, srcW, srcH, destX, destY, destW, destH, flashing) {
  if (flashing) {
    const [buf, bctx] = getScratchCanvas("flash", srcW, srcH);
    bctx.clearRect(0, 0, srcW, srcH);
    bctx.drawImage(src, 0, 0, srcW, srcH);
    bctx.globalCompositeOperation = "source-atop";
    bctx.fillStyle = FLASH_WHITE;
    bctx.fillRect(0, 0, srcW, srcH);
    bctx.globalCompositeOperation = "source-over";
    ctx.drawImage(buf, destX, destY, destW, destH);
    return;
  }

  const screenRimPx = 1.6;
  const mag = screenRimPx / (destH / srcH);
  const [buf, bctx] = getScratchCanvas("rim", srcW, srcH);
  bctx.clearRect(0, 0, srcW, srcH);
  for (const [dx, dy] of OUTLINE_DIRS) {
    bctx.drawImage(src, dx * mag, dy * mag, srcW, srcH);
  }
  bctx.globalCompositeOperation = "source-atop";
  bctx.fillStyle = RIM_LIGHT;
  bctx.fillRect(0, 0, srcW, srcH);
  bctx.globalCompositeOperation = "source-over";
  ctx.drawImage(buf, destX, destY, destW, destH);
  ctx.drawImage(src, destX, destY, destW, destH);
}

// Displayed character height for the procedural rig, in screen pixels —
// used both to size the offscreen blit and to size the raster idle sprite
// to roughly the same height, so swapping between them isn't a visible
// jump in scale.
const CHAR_H = (HEAD_R * 2 + NECK + TORSO_LEN + THIGH + SHIN) * RENDER_SCALE;

function drawPoseSprite(ctx, fighter, img, flashing, isCpu, glitchIntensity) {
  const srcW = img.naturalWidth, srcH = img.naturalHeight;
  const destH = CHAR_H;
  const destW = destH * (srcW / srcH);

  ctx.save();
  if (fighter.invulnerable) ctx.globalAlpha = 0.55;
  const flipped = fighter.facing === -1;
  if (flipped) { ctx.translate(fighter.x, 0); ctx.scale(-1, 1); }
  const cx = flipped ? 0 : fighter.x;

  const destX = cx - destW / 2;
  const destY = fighter.y - destH;
  drawSilhouetteSource(ctx, img, srcW, srcH, destX, destY, destW, destH, flashing);

  ctx.restore();

  if (isCpu && glitchIntensity > 0) {
    drawGlitch(ctx, fighter.x, destY, fighter.y, glitchIntensity);
  }
}

export function drawFighterSprite(ctx, fighter, { isCpu = false, glitchIntensity = 0 } = {}) {
  const poseKey = poseFor(fighter);
  const flashing = fighter.flashTimer > 0;

  // A pose with real illustrated art uses it once loaded; every other pose
  // still uses the procedural rig until matching art exists for it — a
  // deliberate, visible seam for now, not a bug.
  const sprite = poseSprites[poseKey];
  if (sprite && sprite.complete && sprite.naturalWidth > 0) {
    drawPoseSprite(ctx, fighter, sprite, flashing, isCpu, glitchIntensity);
    return;
  }

  const pose = poseKey === "walk" ? POSES[walkPhase === 0 ? "walkA" : "walkB"] : (POSES[poseKey] || POSES.idle);

  const weaponId = fighter.profile ? fighter.profile.weapon.id : "blade";
  const weaponColor = fighter.profile ? fighter.profile.weapon.color : "#ffd23f";
  const shieldId = fighter.profile ? fighter.profile.shield.id : "buckler";
  const isBlocking = fighter.state === "block";
  const bodyColor = flashing ? FLASH_WHITE : SILHOUETTE;

  // --- build the right-facing body + weapon/shield on the offscreen canvas ---
  offCtx.clearRect(0, 0, OFF_W, OFF_H);
  const joints = buildBody(offCtx, pose, poseKey, bodyColor);
  if (!isBlocking) {
    if (weaponId === "gauntlets") drawWeapon(offCtx, joints.handF, 0, "gauntlets", bodyColor);
    else drawWeapon(offCtx, joints.handF, pose.shF + pose.elF, weaponId, bodyColor);
  }
  drawShield(offCtx, joints.handB, pose.shB + pose.elB, shieldId, isBlocking, bodyColor);

  ctx.save();
  if (fighter.invulnerable) ctx.globalAlpha = 0.55;

  const flipped = fighter.facing === -1;
  if (flipped) { ctx.translate(fighter.x, 0); ctx.scale(-1, 1); }
  const cx = flipped ? 0 : fighter.x;

  // special-move aura is a brief VFX, not part of the body — it's allowed
  // its own color even though the fighter itself stays a flat silhouette
  if (fighter.state === "special") {
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = weaponColor;
    ctx.beginPath();
    ctx.arc(cx, (joints.headCenterY + joints.hipY) / 2, 70, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const destW = OFF_W * RENDER_SCALE;
  const destH = OFF_H * RENDER_SCALE;
  const destX = cx - destW / 2;
  const destY = fighter.y - ORIGIN_Y * RENDER_SCALE;

  // Rim light: dilate the whole body's silhouette by a pixel or two in
  // every direction on an isolated buffer, then recolor just that buffer —
  // so the result is one continuous light edge around the OUTSIDE of the
  // whole figure, not a separate outline around every limb (which is what
  // was reading as assembled parts rather than a person). The real black
  // body is drawn on top right after, covering everything but that thin
  // outer ring.
  if (!flashing) {
    outlineCtx.clearRect(0, 0, OFF_W, OFF_H);
    for (const [ox, oy] of OUTLINE_DIRS) {
      outlineCtx.drawImage(offCanvas, ox * 1.6, oy * 1.6);
    }
    outlineCtx.globalCompositeOperation = "source-atop";
    outlineCtx.fillStyle = RIM_LIGHT;
    outlineCtx.fillRect(0, 0, OFF_W, OFF_H);
    outlineCtx.globalCompositeOperation = "source-over";
    ctx.drawImage(outlineCanvas, destX, destY, destW, destH);
  }

  ctx.drawImage(offCanvas, destX, destY, destW, destH);

  ctx.restore();

  if (isCpu && glitchIntensity > 0) {
    drawGlitch(ctx, fighter.x, destY, fighter.y, glitchIntensity);
  }
}
