// Fighter physics + animation state machine, driven by a per-fighter combat
// `profile` (see loadout.js) so weapon / shield / stat choices actually
// change movement feel and combat numbers, not just flavor text.

export const PHYSICS = {
  ARENA_WIDTH: 900,
  ARENA_HEIGHT: 480,
  GROUND_Y: 400,
  GRAVITY: 0.9,
  BASE_MOVE_SPEED: 4.2,
  JUMP_VELOCITY: -15,
  FIGHTER_W: 42,
  FIGHTER_H: 78,
  BASE_DASH_DURATION: 200,
  BASE_DASH_SPEED: 9,
  DASH_REGEN_MS: 1400,
  HITSTUN_DURATION: 280,
  PARRY_STUN_DURATION: 500,
  SPECIAL_DURATION: 520,
  SPECIAL_ACTIVE: [150, 420],
  SPECIAL_STARTUP_INVULN: 150,
  SPECIAL_DAMAGE: 24,
  SPECIAL_RANGE_MULT: 2.6,
};

export class Fighter {
  constructor(x, facing, color, profile) {
    this.x = x;
    this.y = PHYSICS.GROUND_Y;
    this.vx = 0;
    this.vy = 0;
    this.onGround = true;
    this.facing = facing;
    this.color = color;
    this.profile = profile;
    this.maxHp = profile.maxHp;
    this.hp = profile.maxHp;
    this.meter = 0;
    this.state = "idle"; // idle|walk|jump|attack|heavy|block|dash|hitstun|special|won|lost
    this.stateTimer = 0;
    this.attackHasHit = false;
    this.invulnerable = false;
    this.flashTimer = 0;
    this.blockElapsed = 0;
    this.dashCharges = profile.dashCharges;
    this.dashRegenTimer = 0;
  }

  get locked() {
    return ["attack", "heavy", "special", "dash", "hitstun", "won", "lost"].includes(this.state);
  }

  activeDuration() {
    if (this.state === "attack") return this.profile.lightDuration;
    if (this.state === "heavy") return this.profile.heavyDuration;
    if (this.state === "special") return PHYSICS.SPECIAL_DURATION;
    return 0;
  }

  elapsedInState() {
    return this.activeDuration() - this.stateTimer;
  }

  startAction(action) {
    if (action === "attack") {
      this.state = "attack";
      this.stateTimer = this.profile.lightDuration;
      this.attackHasHit = false;
    } else if (action === "heavy") {
      this.state = "heavy";
      this.stateTimer = this.profile.heavyDuration;
      this.attackHasHit = false;
    } else if (action === "special") {
      if (this.meter < 100) return false;
      this.meter = 0;
      this.state = "special";
      this.stateTimer = PHYSICS.SPECIAL_DURATION;
      this.attackHasHit = false;
      this.invulnerable = true;
    } else if (action === "dash") {
      if (this.dashCharges <= 0) return false;
      this.dashCharges--;
      this.state = "dash";
      this.stateTimer = PHYSICS.BASE_DASH_DURATION;
      this.invulnerable = true;
      this.vx = PHYSICS.BASE_DASH_SPEED * this.profile.dashSpeedMult * this.facing;
    } else if (action === "jump") {
      if (this.onGround) { this.vy = PHYSICS.JUMP_VELOCITY; this.onGround = false; }
    } else if (action === "block") {
      if (!this.profile.hasBlock) return false;
      if (this.state !== "block") this.blockElapsed = 0;
      this.state = "block";
    }
    return true;
  }

  // Returns { dmg, parried, blocked }
  applyHit(baseDamage, fromFacing) {
    if (this.invulnerable || this.state === "won" || this.state === "lost") {
      return { dmg: 0, parried: false, blocked: false };
    }
    const blocking = this.state === "block";
    if (blocking && this.profile.parryWindow > 0 && this.blockElapsed <= this.profile.parryWindow) {
      // parry: no damage, attacker gets punished with stun
      this.flashTimer = 120;
      return { dmg: 0, parried: true, blocked: false };
    }
    const dmg = blocking ? Math.round(baseDamage * this.profile.blockMult) : baseDamage;
    this.hp = Math.max(0, this.hp - dmg);
    this.flashTimer = 150;
    if (!blocking) {
      this.state = "hitstun";
      this.stateTimer = PHYSICS.HITSTUN_DURATION;
      this.vx = -fromFacing * 3.5;
    }
    return { dmg, parried: false, blocked: blocking };
  }

  parryStun() {
    this.state = "hitstun";
    this.stateTimer = PHYSICS.PARRY_STUN_DURATION;
    this.vx = 0;
  }

  update(dt, input, opponentX) {
    this.flashTimer = Math.max(0, this.flashTimer - dt);

    if (this.dashCharges < this.profile.dashCharges) {
      this.dashRegenTimer += dt;
      if (this.dashRegenTimer >= PHYSICS.DASH_REGEN_MS) {
        this.dashRegenTimer = 0;
        this.dashCharges = Math.min(this.profile.dashCharges, this.dashCharges + 1);
      }
    }

    if (this.hp <= 0) {
      this.state = this.state === "won" ? "won" : "lost";
      this.vx = 0;
      return;
    }

    if (this.locked) {
      this.stateTimer -= dt;
      if (this.state === "special" && this.stateTimer <= PHYSICS.SPECIAL_DURATION - PHYSICS.SPECIAL_STARTUP_INVULN) {
        this.invulnerable = false;
      }
      if (this.state === "dash") {
        // keep sliding
      } else if (this.state !== "attack" && this.state !== "heavy" && this.state !== "special") {
        this.vx *= 0.85;
      }
      if (this.stateTimer <= 0) {
        this.invulnerable = false;
        this.state = this.onGround ? "idle" : "jump";
        this.vx = 0;
      }
    } else {
      this.facing = opponentX >= this.x ? 1 : -1;

      if (input.special && this.startAction("special")) { /* started */ }
      else if (input.heavy) this.startAction("heavy");
      else if (input.attack) this.startAction("attack");
      else if (input.dash) this.startAction("dash");
      else if (input.block && this.profile.hasBlock) {
        this.startAction("block");
        this.blockElapsed += dt;
        this.vx = 0;
      } else {
        if (this.state === "block") this.state = "idle";
        if (input.jump) this.startAction("jump");
        const speed = PHYSICS.BASE_MOVE_SPEED * this.profile.moveSpeedMult;
        if (input.left && !input.right) { this.vx = -speed; this.state = this.onGround ? "walk" : "jump"; }
        else if (input.right && !input.left) { this.vx = speed; this.state = this.onGround ? "walk" : "jump"; }
        else { this.vx = 0; this.state = this.onGround ? "idle" : "jump"; }
      }
    }

    this.vy += PHYSICS.GRAVITY;
    this.y += this.vy;
    if (this.y >= PHYSICS.GROUND_Y) {
      this.y = PHYSICS.GROUND_Y;
      this.vy = 0;
      if (!this.onGround) { this.onGround = true; if (this.state === "jump") this.state = "idle"; }
    } else {
      this.onGround = false;
    }

    this.x += this.vx;
    const minX = PHYSICS.FIGHTER_W / 2;
    const maxX = PHYSICS.ARENA_WIDTH - PHYSICS.FIGHTER_W / 2;
    this.x = Math.max(minX, Math.min(maxX, this.x));
  }

  hurtbox() {
    return {
      x: this.x - PHYSICS.FIGHTER_W / 2,
      y: this.y - PHYSICS.FIGHTER_H,
      w: PHYSICS.FIGHTER_W,
      h: PHYSICS.FIGHTER_H,
    };
  }

  attackHitbox() {
    let range = this.profile.attackRange;
    if (this.state === "special") range *= PHYSICS.SPECIAL_RANGE_MULT;
    const x = this.facing === 1 ? this.x : this.x - range;
    return { x, y: this.y - PHYSICS.FIGHTER_H, w: range, h: PHYSICS.FIGHTER_H };
  }

  currentAttackDamage() {
    if (this.state === "attack") return this.profile.lightDamage;
    if (this.state === "heavy") return this.profile.heavyDamage;
    if (this.state === "special") return PHYSICS.SPECIAL_DAMAGE;
    return 0;
  }

  isAttackActive() {
    if (!["attack", "heavy", "special"].includes(this.state)) return false;
    const t = this.elapsedInState();
    const window = this.state === "attack" ? this.profile.lightActive
      : this.state === "heavy" ? this.profile.heavyActive
      : PHYSICS.SPECIAL_ACTIVE;
    return t >= window[0] && t <= window[1];
  }
}

export function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
