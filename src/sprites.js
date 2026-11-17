// Fighter rendering: an articulated silhouette rig — torso, head, and four
// limb segments (upper arm/forearm, thigh/shin) built from filled, tapered
// shapes driven by a small per-pose angle table, rather than a fixed
// pixel-grid bitmap. That's what lets a heavy attack read as an actual
// flying kick instead of a palette-swapped idle pose.
//
// The fighters themselves are a flat, near-black cutout with no glow or
// color on the body or weapon — same convention as a real backlit side-on
// fighting silhouette: you read the two fighters by position and pose, not
// by a neon outline. Color lives in the HUD (portraits, health bars) and in
// brief VFX (special-move aura, hit flash), never on the body itself.

const SILHOUETTE = "#050506";
const FLASH_WHITE = "#ffffff";

const HEAD_R = 9;
const NECK = 4;
const TORSO_LEN = 35;
const SHOULDER_X = 12;
const HIP_X = 7;
const UPPER_ARM = 21;
const FOREARM = 19;
const THIGH = 27;
const SHIN = 25;

// Tapered widths (wide end -> narrow end) for each limb segment, so a limb
// reads as an actual tapering arm/leg rather than a uniform-width stick —
// and a slim waist / broad shoulders for an athletic, heroic silhouette.
const TORSO_W_HIP = 17;
const TORSO_W_SHOULDER = 29;
const UPPER_ARM_W = [12.5, 9];
const FOREARM_W = [8.5, 6];
const THIGH_W = [16, 12];
const SHIN_W = [10.5, 7];

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

// Filled, tapered quad from p0 (width w0) to p1 (width w1) — a solid wedge
// of "flesh" rather than a uniform stroke, so limbs actually taper like a
// real arm or leg instead of reading as a stick-figure rig.
function tapered(ctx, p0, p1, w0, w1) {
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const h0x = (nx * w0) / 2, h0y = (ny * w0) / 2;
  const h1x = (nx * w1) / 2, h1y = (ny * w1) / 2;
  ctx.beginPath();
  ctx.moveTo(p0.x + h0x, p0.y + h0y);
  ctx.lineTo(p1.x + h1x, p1.y + h1y);
  ctx.lineTo(p1.x - h1x, p1.y - h1y);
  ctx.lineTo(p0.x - h0x, p0.y - h0y);
  ctx.closePath();
  ctx.fill();
}

// A round cap at a joint so two tapered segments blend into one continuous
// silhouette instead of showing a notch at the bend.
function cap(ctx, p, r) {
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
}

// A small flattened foot blob, offset forward (+local x) from the ankle so
// it reads as a foot planted on the ground rather than the shin just
// stopping mid-air.
function footShape(ctx, ankle, size) {
  ctx.beginPath();
  ctx.ellipse(ankle.x + size * 0.55, ankle.y + size * 0.1, size * 0.85, size * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
}

function limbChain(ctx, p0, p1, p2, w) {
  tapered(ctx, p0, p1, w[0][0], w[0][1]);
  cap(ctx, p1, w[0][1] / 2);
  tapered(ctx, p1, p2, w[1][0], w[1][1]);
}

// Weapon and shield are drawn in the same flat silhouette tone as the body
// — like the body, they read by shape, not by color — with a hairline
// translucent edge so a blade or shield rim still separates visually from
// whatever's directly behind it.
function drawWeapon(ctx, hand, armAngle, weaponId) {
  ctx.save();
  ctx.translate(hand.x, hand.y);
  ctx.rotate(armAngle);
  ctx.fillStyle = SILHOUETTE;
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1;

  if (weaponId === "blade") {
    ctx.beginPath();
    ctx.moveTo(-2.5, 6);
    ctx.lineTo(2.5, 6);
    ctx.lineTo(1.8, 46);
    ctx.lineTo(0, 52);
    ctx.lineTo(-1.8, 46);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (weaponId === "spear") {
    ctx.beginPath();
    ctx.moveTo(-1.8, 0);
    ctx.lineTo(1.8, 0);
    ctx.lineTo(1.8, 58);
    ctx.lineTo(0, 70);
    ctx.lineTo(-1.8, 58);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (weaponId === "gauntlets") {
    ctx.beginPath();
    ctx.arc(0, 4, 7.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawShield(ctx, hand, armAngle, shieldId, isBlocking) {
  if (shieldId === "evasive") return; // bare off-hand — nothing extra to draw

  const scale = isBlocking ? 1.6 : 0.85;
  ctx.save();
  ctx.translate(hand.x, hand.y);
  ctx.rotate(armAngle * 0.3);
  ctx.fillStyle = SILHOUETTE;
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1;

  if (shieldId === "buckler") {
    const r = 11 * scale;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
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
    ctx.stroke();
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
    ctx.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,0.4)" : "rgba(190,190,200,0.35)";
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
  const isBlocking = fighter.state === "block";
  const flashing = fighter.flashTimer > 0;
  const bodyColor = flashing ? FLASH_WHITE : SILHOUETTE;

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

  // special-move aura is a brief VFX, not part of the body — it's allowed
  // its own color even though the fighter itself stays a flat silhouette
  if (fighter.state === "special") {
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = weaponColor;
    ctx.beginPath();
    ctx.arc(cx, (headCenterY + hipY) / 2, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.fillStyle = bodyColor;

  // legs (back leg drawn first so the front leg overlaps it)
  const hipB = { x: cx - HIP_X + torsoLeanX * 0.3, y: hipY };
  const kneeB = pointAt(hipB.x, hipB.y, pose.hipB, THIGH);
  const footB = pointAt(kneeB.x, kneeB.y, pose.hipB + pose.kneeB, SHIN);
  limbChain(ctx, hipB, kneeB, footB, [THIGH_W, SHIN_W]);
  footShape(ctx, footB, SHIN_W[1]);

  const hipF = { x: cx + HIP_X + torsoLeanX * 0.3, y: hipY };
  const kneeF = pointAt(hipF.x, hipF.y, pose.hipF, THIGH);
  const footF = pointAt(kneeF.x, kneeF.y, pose.hipF + pose.kneeF, SHIN);
  limbChain(ctx, hipF, kneeF, footF, [THIGH_W, SHIN_W]);
  footShape(ctx, footF, SHIN_W[1]);

  // torso — tapered narrow-hip to wide-shoulder, with rounded caps at each
  // end so the limbs attached at the edges blend into it with no seam
  const hipCenter = { x: cx + torsoLeanX * 0.3, y: hipY };
  const shoulderCenter = { x: cx + torsoLeanX, y: shoulderY };
  tapered(ctx, hipCenter, shoulderCenter, TORSO_W_HIP, TORSO_W_SHOULDER);
  cap(ctx, hipCenter, TORSO_W_HIP / 2);
  cap(ctx, shoulderCenter, TORSO_W_SHOULDER / 2);

  // back arm (behind torso)
  const shB = { x: shoulderCenter.x - SHOULDER_X, y: shoulderCenter.y };
  const elB = pointAt(shB.x, shB.y, pose.shB, UPPER_ARM);
  const handB = pointAt(elB.x, elB.y, pose.shB + pose.elB, FOREARM);
  limbChain(ctx, shB, elB, handB, [UPPER_ARM_W, FOREARM_W]);
  cap(ctx, handB, FOREARM_W[1] / 2 + 1);

  // head
  const headCenter = { x: shoulderCenter.x, y: headCenterY };
  cap(ctx, { x: headCenter.x, y: headCenter.y + HEAD_R * 0.7 }, HEAD_R * 0.7); // neck taper into jaw
  ctx.beginPath();
  ctx.arc(headCenter.x, headCenter.y, HEAD_R, 0, Math.PI * 2);
  ctx.fill();

  // front arm (in front of torso)
  const shF = { x: shoulderCenter.x + SHOULDER_X, y: shoulderCenter.y };
  const elF = pointAt(shF.x, shF.y, pose.shF, UPPER_ARM);
  const handF = pointAt(elF.x, elF.y, pose.shF + pose.elF, FOREARM);
  limbChain(ctx, shF, elF, handF, [UPPER_ARM_W, FOREARM_W]);
  cap(ctx, handF, FOREARM_W[1] / 2 + 1);

  // weapon + shield, anchored to the actual hand positions via forward kinematics
  if (!isBlocking) {
    if (weaponId === "gauntlets") drawWeapon(ctx, handF, 0, "gauntlets");
    else drawWeapon(ctx, handF, pose.shF + pose.elF, weaponId);
  }
  drawShield(ctx, handB, pose.shB + pose.elB, shieldId, isBlocking);

  ctx.restore();

  if (isCpu && glitchIntensity > 0) {
    drawGlitch(ctx, fighter.x, headCenterY - HEAD_R, fighter.y, glitchIntensity);
  }
}
