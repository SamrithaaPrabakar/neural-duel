// Tiny particle system for hit sparks / dash trails. Pure visual juice.

export class Particles {
  constructor() {
    this.items = [];
  }

  burst(x, y, color, count = 10, speed = 4) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = speed * (0.4 + Math.random() * 0.8);
      this.items.push({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd - 1,
        life: 300 + Math.random() * 200,
        maxLife: 500,
        color,
        size: 2 + Math.random() * 3,
      });
    }
  }

  update(dt) {
    for (const p of this.items) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.15;
      p.life -= dt;
    }
    this.items = this.items.filter((p) => p.life > 0);
  }

  draw(ctx) {
    for (const p of this.items) {
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
