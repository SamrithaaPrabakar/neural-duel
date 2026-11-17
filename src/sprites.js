// Fighter rendering: an articulated silhouette rig — torso, head, and four
// limb segments (upper arm/forearm, thigh/shin) built from filled, curved
// shapes driven by a small per-pose angle table, rather than a fixed
// pixel-grid bitmap. That's what lets a heavy attack read as an actual
// flying kick instead of a palette-swapped idle pose.
//
// Each segment is a gently bulging wedge (not a straight-edged taper, which
// reads as a pipe/tube), and every joint shares an exact width with the
// segment on the other side of it plus a cap circle of that same radius —
// so two segments blend into one continuous body with no notch at the
// bend, the thing that was making the rig read as assembled parts rather
// than a human.
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
  // a quadratic curve's peak deviates from the chord midpoint by half the
  // control point's own offset, so double the desired extra bow here
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
  limbChain(ctx, hipB, kneeB, footB, [THIGH_W, SHIN_W], 0.28);
  footShape(ctx, footB, ANKLE_W);

  const hipF = { x: cx + HIP_X + torsoLeanX * 0.3, y: hipY };
  const kneeF = pointAt(hipF.x, hipF.y, pose.hipF, THIGH);
  const footF = pointAt(kneeF.x, kneeF.y, pose.hipF + pose.kneeF, SHIN);
  limbChain(ctx, hipF, kneeF, footF, [THIGH_W, SHIN_W], 0.28);
  footShape(ctx, footF, ANKLE_W);

  // torso — one continuous curved taper from hip to shoulder; its ends are
  // already flat lines the right width, so unlike the limbs it needs no
  // round cap of its own (the arms/legs round off their own attachment
  // points onto it instead)
  const hipCenter = { x: cx + torsoLeanX * 0.3, y: hipY };
  const shoulderCenter = { x: cx + torsoLeanX, y: shoulderY };
  limb(ctx, hipCenter, shoulderCenter, TORSO_W[0], TORSO_W[1], 0.08);

  // back arm (behind torso)
  const shB = { x: shoulderCenter.x - SHOULDER_X, y: shoulderCenter.y };
  const elB = pointAt(shB.x, shB.y, pose.shB, UPPER_ARM);
  const handB = pointAt(elB.x, elB.y, pose.shB + pose.elB, FOREARM);
  limbChain(ctx, shB, elB, handB, [UPPER_ARM_W, FOREARM_W], 0.3);
  cap(ctx, handB, WRIST_W + 2);

  // head, with a short tapered neck instead of the head sitting flush on
  // the shoulders
  const headCenter = { x: shoulderCenter.x, y: headCenterY };
  const neckBase = { x: shoulderCenter.x, y: headCenter.y + HEAD_R * 0.85 };
  limb(ctx, shoulderCenter, neckBase, NECK_W, NECK_W * 0.8, 0.1);
  cap(ctx, neckBase, NECK_W * 0.8);
  ctx.beginPath();
  ctx.arc(headCenter.x, headCenter.y, HEAD_R, 0, Math.PI * 2);
  ctx.fill();

  // front arm (in front of torso)
  const shF = { x: shoulderCenter.x + SHOULDER_X, y: shoulderCenter.y };
  const elF = pointAt(shF.x, shF.y, pose.shF, UPPER_ARM);
  const handF = pointAt(elF.x, elF.y, pose.shF + pose.elF, FOREARM);
  limbChain(ctx, shF, elF, handF, [UPPER_ARM_W, FOREARM_W], 0.3);
  cap(ctx, handF, WRIST_W + 2);

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
