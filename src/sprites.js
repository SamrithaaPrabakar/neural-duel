// Fighter rendering: an articulated silhouette rig — torso, head, and four
// limb segments (upper arm/forearm, thigh/shin) drawn as rotated, round-
// capped strokes from a small per-pose angle table, rather than a fixed
// pixel-grid bitmap. That's what lets a heavy attack read as an actual
// flying kick instead of a palette-swapped idle pose.
//
// Each fighter's silhouette carries a soft glow in its weapon's accent
// color (shadowBlur), which is also how the CPU's glitch overlay and hit
// flashes read against a mostly-black body.
//
// The CPU fighter additionally renders a "glitch" overlay whose intensity
// is driven by the Q-learner's epsilon: lots of noise early (it's acting
// randomly), clean and solid once it has mostly stopped exploring.

const BODY_INK = "#101118";
const FLASH_WHITE = "#ffffff";

const HEAD_R = 10;
const NECK = 5;
const TORSO_LEN = 32;
const SHOULDER_X = 8;
const HIP_X = 6;
const UPPER_ARM = 19;
const FOREARM = 17;
const THIGH = 23;
const SHIN = 21;
const ARM_W = 9;
const LEG_W = 11;
const TORSO_W = 15;

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

function strokeSeg(ctx, p0, p1, width, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.stroke();
}

function drawWeapon(ctx, hand, armAngle, weaponId, color) {
  ctx.save();
  ctx.translate(hand.x, hand.y);
  ctx.rotate(armAngle);

  if (weaponId === "blade") {
    ctx.fillStyle = "#1c1d24";
    ctx.fillRect(-3, -4, 6, 10);
    ctx.fillStyle = "#0a0a0d";
    ctx.fillRect(-10, 5, 20, 3.5);
    ctx.fillStyle = color;
    ctx.fillRect(-3.5, 8.5, 7, 32);
    ctx.beginPath();
    ctx.moveTo(-3.5, 40.5);
    ctx.lineTo(3.5, 40.5);
    ctx.lineTo(0, 49);
    ctx.closePath();
    ctx.fill();
  } else if (weaponId === "spear") {
    ctx.fillStyle = "#5a4328";
    ctx.fillRect(-2.2, -4, 4.4, 50);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-6, 46);
    ctx.lineTo(6, 46);
    ctx.lineTo(0, 64);
    ctx.closePath();
    ctx.fill();
  } else if (weaponId === "gauntlets") {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 4, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.arc(-3, 1, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawShield(ctx, hand, armAngle, shieldId, color, isBlocking) {
  if (shieldId === "evasive") {
    ctx.save();
    ctx.translate(hand.x, hand.y);
    ctx.fillStyle = "#1c1d24";
    ctx.beginPath();
    ctx.arc(0, -2, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  const scale = isBlocking ? 1.7 : 0.85;
  ctx.save();
  ctx.translate(hand.x, hand.y);
  ctx.rotate(armAngle * 0.3);

  if (shieldId === "buckler") {
    const r = 12 * scale;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.32, 0, Math.PI * 2);
    ctx.fill();
  } else if (shieldId === "tower") {
    const w = 18 * scale, h = 36 * scale;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2);
    ctx.lineTo(w / 2, -h / 2);
    ctx.lineTo(w / 2, h / 2 - 7);
    ctx.lineTo(0, h / 2);
    ctx.lineTo(-w / 2, h / 2 - 7);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0); ctx.stroke();
  }
  ctx.restore();
}

function drawGlitch(ctx, cx, topY, bottomY, intensity) {
  if (intensity <= 0) return;
  const w = 56;
  const h = bottomY - topY;
  const bands = Math.floor(intensity * 10);
  for (let i = 0; i < bands; i++) {
    const by = topY + Math.random() * h;
    const bh = 2 + Math.random() * 4;
    const bx = cx - w / 2 + (Math.random() - 0.5) * 10 * intensity;
    ctx.fillStyle = Math.random() < 0.5 ? "rgba(0,240,255,0.4)" : "rgba(255,0,140,0.35)";
    ctx.fillRect(bx, by, w, bh);
  }
}

export function spriteSize() {
  return { w: 56, h: HEAD_R * 2 + NECK + TORSO_LEN + THIGH + SHIN };
}

export function drawFighterSprite(ctx, fighter, { isCpu = false, glitchIntensity = 0 } = {}) {
  const poseKey = poseFor(fighter);
  const pose = poseKey === "walk" ? POSES[walkPhase === 0 ? "walkA" : "walkB"] : (POSES[poseKey] || POSES.idle);

  const weaponId = fighter.profile ? fighter.profile.weapon.id : "blade";
  const weaponColor = fighter.profile ? fighter.profile.weapon.color : "#ffd23f";
  const shieldId = fighter.profile ? fighter.profile.shield.id : "buckler";
  const shieldColor = fighter.profile ? fighter.profile.shieldColor : "#9ad1ff";
  const isBlocking = fighter.state === "block";
  const flashing = fighter.flashTimer > 0;
  const bodyColor = flashing ? FLASH_WHITE : BODY_INK;
  const glowColor = flashing ? "#ffffff" : weaponColor;

  // heavy has no real airtime in the physics (it's a grounded, timed state) —
  // this cosmetic hip lift is what sells it as an actual flying kick.
  const heavyLift = poseKey === "heavy" ? -16 : 0;
  const hipY = fighter.y - (THIGH + SHIN) - 4 + heavyLift;
  const shoulderY = hipY - TORSO_LEN;
  const headCenterY = shoulderY - NECK - HEAD_R;
  const torsoLeanX = Math.sin(pose.lean) * TORSO_LEN * 0.4;

  ctx.save();
  if (fighter.invulnerable) ctx.globalAlpha = 0.55;

  const flipped = fighter.facing === -1;
  if (flipped) { ctx.translate(fighter.x, 0); ctx.scale(-1, 1); }
  const cx = flipped ? 0 : fighter.x;

  if (fighter.state === "special") {
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = weaponColor;
    ctx.beginPath();
    ctx.arc(cx, (headCenterY + hipY) / 2, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.shadowColor = glowColor;
  ctx.shadowBlur = flashing ? 16 : 9;

  // legs (back leg drawn first so the front leg overlaps it)
  const hipB = { x: cx - HIP_X + torsoLeanX * 0.3, y: hipY };
  const kneeB = pointAt(hipB.x, hipB.y, pose.hipB, THIGH);
  const footB = pointAt(kneeB.x, kneeB.y, pose.hipB + pose.kneeB, SHIN);
  strokeSeg(ctx, hipB, kneeB, LEG_W, bodyColor);
  strokeSeg(ctx, kneeB, footB, LEG_W * 0.85, bodyColor);

  const hipF = { x: cx + HIP_X + torsoLeanX * 0.3, y: hipY };
  const kneeF = pointAt(hipF.x, hipF.y, pose.hipF, THIGH);
  const footF = pointAt(kneeF.x, kneeF.y, pose.hipF + pose.kneeF, SHIN);
  strokeSeg(ctx, hipF, kneeF, LEG_W, bodyColor);
  strokeSeg(ctx, kneeF, footF, LEG_W * 0.85, bodyColor);

  // torso
  const hipCenter = { x: cx + torsoLeanX * 0.3, y: hipY };
  const shoulderCenter = { x: cx + torsoLeanX, y: shoulderY };
  strokeSeg(ctx, hipCenter, shoulderCenter, TORSO_W, bodyColor);

  // back arm (behind torso)
  const shB = { x: shoulderCenter.x - SHOULDER_X, y: shoulderCenter.y };
  const elB = pointAt(shB.x, shB.y, pose.shB, UPPER_ARM);
  const handB = pointAt(elB.x, elB.y, pose.shB + pose.elB, FOREARM);
  strokeSeg(ctx, shB, elB, ARM_W, bodyColor);
  strokeSeg(ctx, elB, handB, ARM_W * 0.85, bodyColor);

  // head
  const headCenter = { x: shoulderCenter.x, y: headCenterY };
  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.arc(headCenter.x, headCenter.y, HEAD_R, 0, Math.PI * 2);
  ctx.fill();

  // front arm (in front of torso)
  const shF = { x: shoulderCenter.x + SHOULDER_X, y: shoulderCenter.y };
  const elF = pointAt(shF.x, shF.y, pose.shF, UPPER_ARM);
  const handF = pointAt(elF.x, elF.y, pose.shF + pose.elF, FOREARM);
  strokeSeg(ctx, shF, elF, ARM_W, bodyColor);
  strokeSeg(ctx, elF, handF, ARM_W * 0.85, bodyColor);

  ctx.shadowBlur = 0;

  // eye glow — small, reads facing + identity even at a glance
  ctx.fillStyle = flashing ? "#ffffff" : weaponColor;
  ctx.beginPath();
  ctx.arc(headCenter.x + 3.5, headCenter.y - 1, 1.6, 0, Math.PI * 2);
  ctx.fill();

  // weapon + shield, anchored to the actual hand positions via forward kinematics
  if (!isBlocking) {
    if (weaponId === "gauntlets") drawWeapon(ctx, handF, 0, "gauntlets", weaponColor);
    else drawWeapon(ctx, handF, pose.shF + pose.elF, weaponId, weaponColor);
  }
  drawShield(ctx, handB, pose.shB + pose.elB, shieldId, shieldColor, isBlocking);

  ctx.restore();

  if (isCpu && glitchIntensity > 0) {
    drawGlitch(ctx, fighter.x, headCenterY - HEAD_R, fighter.y, glitchIntensity);
  }
}
